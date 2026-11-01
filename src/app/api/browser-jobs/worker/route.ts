import { badRequest, json, readJson, type Db } from "@/lib/server/auth";
import { UUID_RE, workerAuth } from "@/lib/server/worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { openVault } from "@/lib/builtins/vault";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { sendPushToUser } from "@/lib/server/push";

export const dynamic = "force-dynamic";

/**
 * Trusted browser worker only (Bearer SESSION_WORKER_SECRET). Actions:
 *  claim  -> the oldest queued job (atomically moved to running)
 *  secret -> one vault field for a fill_secret step of a RUNNING job that lists that secret
 *  finish -> store the result (done/failed) and notify the owner
 */
export async function POST(req: Request) {
  const auth = workerAuth(req);
  if (auth === "unconfigured") return json({ error: "Browser worker is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }

  if (b.action === "claim") {
    // Jobs stuck in running for 10+ minutes are failed so they never block the queue.
    await db.from("browser_jobs").update({ status: "failed", error: "The browser worker stopped responding", finished_at: new Date().toISOString() })
      .eq("status", "running").lt("claimed_at", new Date(Date.now() - 600000).toISOString());
    const { data: next } = await db.from("browser_jobs").select("id").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
    if (!next?.length) return json({ job: null });
    const { data } = await db.from("browser_jobs").update({ status: "running", claimed_at: new Date().toISOString() })
      .eq("id", next[0].id).eq("status", "queued").select("id, user_id, goal, start_url, steps");
    return json({ job: data?.[0] ?? null });
  }

  const id = typeof b.job_id === "string" && UUID_RE.test(b.job_id) ? b.job_id : null;
  if (!id) return badRequest("job_id required");
  const { data: job } = await db.from("browser_jobs").select("id, user_id, goal, status, steps").eq("id", id).maybeSingle();
  if (!job || job.status !== "running") return json({ error: "Job is not running" }, 409);

  if (b.action === "secret") {
    const sid = typeof b.secret_id === "string" ? b.secret_id : "";
    const field = typeof b.field === "string" ? b.field : "";
    const steps = (job.steps ?? []) as { action?: string; secret_id?: string; field?: string }[];
    if (!steps.some((s) => s.action === "fill_secret" && s.secret_id === sid && s.field === field)) return json({ error: "That secret isn't part of this job" }, 403);
    if (!(await checkLimit({ key: `vault-read:${job.user_id}`, limit: 20, windowSec: 600 }))) return json({ error: "Too many requests" }, 429);
    const { data: row } = await db.from("vault_secrets").select("secret_box").eq("id", sid).eq("user_id", job.user_id).maybeSingle();
    if (!row) return json({ error: "Secret not found" }, 404);
    const fields = openVault(job.user_id as string, row.secret_box as string);
    await db.from("vault_secrets").update({ last_used_at: new Date().toISOString() }).eq("id", sid);
    if (!(field in fields)) return json({ error: "That field isn't saved" }, 404);
    return new Response(JSON.stringify({ value: fields[field] }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  if (b.action === "finish") {
    const ok = b.status === "done";
    await db.from("browser_jobs").update({
      status: ok ? "done" : "failed", result: typeof b.result === "string" ? b.result.slice(0, 20000) : null,
      error: ok ? null : String(b.error ?? "The browser task failed").slice(0, 500), finished_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "running");
    try { await sendPushToUser(db, job.user_id as string, { title: ok ? "Browser task done" : "Browser task failed", body: String(job.goal).slice(0, 120), url: "/app/settings/browser", tag: `browser-${id}` }); } catch { /* optional */ }
    return json({ ok: true });
  }
  return badRequest("Unknown action");
}
