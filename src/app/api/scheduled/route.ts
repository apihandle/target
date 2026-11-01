import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { JOB_COLS, MAX_JOBS_PER_USER, nextRunAt, validateJob, type ScheduledJob } from "@/lib/schedule";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("scheduled_jobs").select(JOB_COLS).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return dbError(error, "Could not load scheduled prompts");
  return json({ jobs: data });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateJob(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const job = v.value as Required<Pick<ScheduledJob, "title" | "prompt" | "cadence" | "weekday" | "run_on" | "interval_hours" | "time_of_day" | "timezone" | "project_id">>;
  if (job.project_id) {
    const { data: p } = await a.db.from("projects").select("id").eq("id", job.project_id).eq("user_id", a.user.id).maybeSingle();
    if (!p) return json({ error: "Project not found", field: "project_id" }, 404);
  }
  const { count } = await a.db.from("scheduled_jobs").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= MAX_JOBS_PER_USER) return badRequest(`You can keep up to ${MAX_JOBS_PER_USER} scheduled prompts. Delete one first.`);
  const status = v.value.status ?? "active";
  if (status === "done") return badRequest("Bad status");
  const first = nextRunAt(job);
  if (status === "active" && !first) return json({ error: "That time has already passed", field: "run_on" }, 400);
  const { data, error } = await a.db.from("scheduled_jobs").insert({
    user_id: a.user.id, ...job, status, next_run_at: status === "active" && first ? first.toISOString() : null,
  }).select(JOB_COLS).single();
  if (error || !data) return dbError(error, "Could not save the scheduled prompt");
  await logActivity(a.db, a.user.id, { category: "task", title: `Scheduled prompt added: “${job.title}”`, project_id: job.project_id });
  return json({ job: data }, 201);
}
