import { badRequest, json, readJson, type Db } from "@/lib/server/auth";
import { COMPUTE_MODES, UUID_RE, workerAuth } from "@/lib/server/worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeVideo } from "@/lib/server/autoBrowser";
import { withAiUsage } from "@/lib/aiUsage";
import { storeJobFiles } from "@/lib/server/jobFiles";
import { sendPushToUser } from "@/lib/server/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The separate compute worker (worker/compute-worker.mjs): Bearer COMPUTE_WORKER_SECRET. Off (503) unless that is set.
 * It can only take code and video jobs and report on them:
 *   claim    -> the oldest queued code / video job (moved to running)
 *   progress -> one line in the job's live log
 *   finish   -> result (+ files from out/, or video frames + captions that TARGET describes), posted to the chat
 * No vault, session, code or link actions exist here, so this secret can't read any of the user's secrets.
 */
export async function POST(req: Request) {
  const auth = workerAuth(req, process.env, "COMPUTE_WORKER_SECRET");
  if (auth === "unconfigured") return json({ error: "Compute worker is not enabled" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  const modes = [...COMPUTE_MODES];

  if (b.action === "claim") {
    await db.from("browser_jobs").update({ status: "failed", error: "The compute worker stopped responding", finished_at: new Date().toISOString() })
      .eq("status", "running").in("mode", modes).lt("claimed_at", new Date(Date.now() - 600000).toISOString());
    const { data: next } = await db.from("browser_jobs").select("id").eq("status", "queued").in("mode", modes).order("created_at", { ascending: true }).limit(1);
    if (!next?.length) return json({ job: null });
    const { data } = await db.from("browser_jobs").update({ status: "running", claimed_at: new Date().toISOString() })
      .eq("id", next[0].id).eq("status", "queued").select("id, mode, goal, start_url, language, code, inputs");
    return json({ job: data?.[0] ?? null });
  }

  const id = typeof b.job_id === "string" && UUID_RE.test(b.job_id) ? b.job_id : null;
  if (!id) return badRequest("job_id required");
  const { data: job } = await db.from("browser_jobs").select("id, user_id, goal, status, mode, log, conversation_id").eq("id", id).maybeSingle();
  if (!job || job.status !== "running" || !(modes as string[]).includes(job.mode as string)) return json({ error: "Job is not running" }, 409);

  if (b.action === "progress") {
    const line = typeof b.line === "string" ? b.line.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!line) return badRequest("line required");
    await db.from("browser_jobs").update({ log: [...((job.log ?? []) as string[]).slice(-40), line] }).eq("id", id);
    return json({ ok: true });
  }

  if (b.action === "finish") {
    const ok = b.status === "done";
    let result = typeof b.result === "string" ? b.result : null;
    if (ok && job.mode === "video") {
      const frames = Array.isArray(b.frames) ? (b.frames as unknown[]).filter((f): f is string => typeof f === "string" && f.length < 400000).slice(0, 8) : [];
      result = await withAiUsage({ userId: job.user_id as string, feature: "video" }, () => describeVideo(job.goal as string, typeof b.title === "string" ? b.title.slice(0, 300) : "", typeof b.captions === "string" ? b.captions : "", frames));
    }
    const files = job.mode === "code" ? await storeJobFiles(db, job.user_id as string, b.files) : [];
    const error = ok ? null : String(b.error ?? "The task failed").slice(0, 500);
    await db.from("browser_jobs").update({ status: ok ? "done" : "failed", result: result ? result.slice(0, 20000) : null, files, error, finished_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
    if (job.conversation_id) {
      const what = job.mode === "video" ? "Video" : "Code run";
      const head = ok ? `🧮 **${what} done:** ${job.goal}` : `⚠️ **${what} failed:** ${job.goal}`;
      const links = files.map((f) => `- [${f.name}](${f.url})`).join("\n");
      const content = [head, ok ? (result ?? "").slice(0, 6000) : error, links].filter(Boolean).join("\n\n");
      await db.from("messages").insert({ conversation_id: job.conversation_id, user_id: job.user_id, role: "assistant", content });
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", job.conversation_id);
    }
    try { await sendPushToUser(db, job.user_id as string, { title: ok ? "Task done" : "Task failed", body: String(job.goal).slice(0, 120), url: "/app/settings/browser", tag: `job-${id}` }); } catch { /* optional */ }
    return json({ ok: true });
  }
  return badRequest("Unknown action");
}
