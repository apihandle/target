import { json, type Db } from "@/lib/server/auth";
import { cronAuth } from "@/lib/server/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimJob, runScheduledJob } from "@/lib/server/scheduledRun";
import { JOB_COLS, type ScheduledJob } from "@/lib/schedule";

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

  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }

  const start = Date.now();
  const now = new Date(start);
  const { data, error } = await db.from("scheduled_jobs").select(`${JOB_COLS}, user_id`).eq("status", "active").lte("next_run_at", now.toISOString()).order("next_run_at", { ascending: true }).limit(BATCH);
  if (error) { console.error("[cron] could not load jobs:", error.message); return json({ error: "Could not load jobs" }, 500); }
  const due = (data ?? []) as (ScheduledJob & { user_id: string })[];

  const results = await Promise.all(due.map(async (job) => {
    if (!(await claimJob(db, job, now))) return { id: job.id, status: "skipped" };
    const out = await runScheduledJob(db, job, { deadline: start + BUDGET_MS });
    await db.from("scheduled_jobs").update({
      last_status: out.status, last_error: out.error ? out.error.slice(0, 400) : null, last_task_id: out.taskId,
      run_count: (job.run_count ?? 0) + 1, updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("user_id", job.user_id);
    return { id: job.id, status: out.status };
  }));
  return json({ ran: results.filter((r) => r.status !== "skipped").length, results });
}

export const GET = handle;
export const POST = handle;
