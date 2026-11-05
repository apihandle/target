import { json, type Db } from "@/lib/server/auth";
import { cronAuth } from "@/lib/server/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimJob, runScheduledJob } from "@/lib/server/scheduledRun";
import { JOB_COLS, type ScheduledJob } from "@/lib/schedule";
import { sendPushToUser } from "@/lib/server/push";
import { reportError } from "@/lib/server/errors";
import { featureOn, recordCronRun } from "@/lib/server/adminSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Jobs started per invocation; each gets the remaining time budget. */
const BATCH = 3;
const BUDGET_MS = 50_000;

/**
 * Vercel Cron entry point (see vercel.json). Picks active jobs whose next_run_at has passed, claims
 * each one atomically (so overlapping invocations never run a job twice), and runs it for its owner
 * through the agent/tasks system. Results land in Tasks and Activity; approvals still wait for the user.
 */
async function handle(req: Request) {
  const auth = cronAuth(req);
  if (auth === "unconfigured") return json({ error: "Cron is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  // The admin "Run cron now" button calls this handler on the server with the same bearer header and this marker
  // (only read after the secret check, so it can't be spoofed from outside).
  const by = req.headers.get("x-target-run-by") === "admin" ? "admin" : "cron";

  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  // Admin kill-switch: scheduled prompts paused site-wide. The heartbeat still records that cron is alive.
  if (!(await featureOn("scheduled"))) { await recordCronRun(db, "scheduled", { ran: 0, by, disabled: true }); return json({ ran: 0, disabled: true }); }
  try { const { purgeExpiredSessions } = await import("@/lib/server/siteSessions"); await purgeExpiredSessions(); } catch { /* housekeeping only */ }

  const start = Date.now();
  const now = new Date(start);
  const { data, error } = await db.from("scheduled_jobs").select(`${JOB_COLS}, user_id`).eq("status", "active").lte("next_run_at", now.toISOString()).order("next_run_at", { ascending: true }).limit(BATCH);
  if (error) { await reportError({ source: "cron", message: `Could not load scheduled jobs: ${error.message}` }, db); return json({ error: "Could not load jobs" }, 500); }
  const due = (data ?? []) as (ScheduledJob & { user_id: string })[];

  const results = await Promise.all(due.map(async (job) => {
    if (!(await claimJob(db, job, now))) return { id: job.id, status: "skipped" };
    const out = await runScheduledJob(db, job, { deadline: start + BUDGET_MS });
    await db.from("scheduled_jobs").update({
      last_status: out.status, last_error: out.error ? out.error.slice(0, 400) : null, last_task_id: out.taskId,
      run_count: (job.run_count ?? 0) + 1, updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("user_id", job.user_id);
    // Tell the owner's phone. Push is optional: failures here never fail the job.
    const failed = !!out.error;
    try {
      await sendPushToUser(db, job.user_id, {
        title: failed ? "Scheduled prompt failed" : out.status === "waiting_approval" ? "Needs your approval" : out.status === "needs_connection" ? "Needs a connection" : "Scheduled prompt done",
        body: failed ? `${job.title}: ${out.error!.slice(0, 120)}` : job.title,
        url: out.status === "waiting_approval" ? "/app/activity" : out.conversationId ? `/app?c=${out.conversationId}` : "/app/activity", tag: `job-${job.id}`,
      });
    } catch (e) { console.error("[cron] push failed:", e instanceof Error ? e.message : e); }
    if (failed) await reportError({ source: "cron", message: `Scheduled job failed: ${out.error!.slice(0, 300)}`, userId: job.user_id }, db);
    return { id: job.id, status: out.status };
  }));
  const ran = results.filter((r) => r.status !== "skipped").length;
  await recordCronRun(db, "scheduled", { ran, by });
  return json({ ran, results });
}

export const GET = handle;
export const POST = handle;
