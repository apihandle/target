import { badRequest, json, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeOutFiles } from "@/lib/server/jobFiles";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function admin(): Db | null {
  try { return createAdminClient() as unknown as Db; } catch { return null; }
}

/** GET: the signed-in user's oldest code run waiting for their own browser, claimed (moved to running) atomically. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const db = admin();
  if (!db) return json({ job: null });
  // A browser run left "running" for 3+ minutes (tab closed) is failed so it can't hang forever.
  await db.from("browser_jobs").update({ status: "failed", error: "The browser tab closed before the code finished", finished_at: new Date().toISOString() })
    .eq("user_id", a.user.id).eq("mode", "browser_code").eq("status", "running").lt("claimed_at", new Date(Date.now() - 180000).toISOString());
  const { data: next } = await db.from("browser_jobs").select("id").eq("user_id", a.user.id).eq("mode", "browser_code").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
  if (!next?.length) return json({ job: null });
  const { data } = await db.from("browser_jobs").update({ status: "running", claimed_at: new Date().toISOString() })
    .eq("id", next[0].id).eq("user_id", a.user.id).eq("status", "queued").select("id, goal, language, code, inputs");
  return json({ job: data?.[0] ?? null });
}

/** POST { job_id, status: "done"|"failed", result?, error?, files?: [{name, base64}] }: the browser reports its run. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const b = await readJson(req);
  const id = typeof b?.job_id === "string" && isUuid(b.job_id) ? b.job_id : null;
  if (!b || !id) return badRequest("job_id required");
  const db = admin();
  if (!db) return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503);
  const { data: job } = await db.from("browser_jobs").select("id, status, mode").eq("id", id).eq("user_id", a.user.id).maybeSingle();
  if (!job || job.mode !== "browser_code" || job.status !== "running") return json({ error: "This run isn't waiting for a result" }, 409);
  const ok = b.status === "done";
  const files = ok ? await storeOutFiles(db, a.user.id, b.files) : [];
  await db.from("browser_jobs").update({
    status: ok ? "done" : "failed", result: typeof b.result === "string" ? b.result.slice(0, 20000) : null, files,
    error: ok ? null : String(b.error ?? "The code failed").slice(0, 500), finished_at: new Date().toISOString(),
  }).eq("id", id).eq("user_id", a.user.id).eq("status", "running");
  return json({ ok: true, files });
}
