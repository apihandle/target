import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { JOB_COLS, nextRunAt, validateJob, type ScheduledJob } from "@/lib/schedule";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Edit, pause or resume a scheduled prompt. next_run_at is recomputed whenever it's (re)activated or rescheduled. */
export async function PATCH(req: Request, props: Ctx) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const { data: cur } = await a.db.from("scheduled_jobs").select(JOB_COLS).eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!cur) return notFound();
  const v = validateJob(body, true);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const merged = { ...(cur as ScheduledJob), ...v.value } as ScheduledJob;
  if (merged.cadence === "weekly" && (merged.weekday === null || merged.weekday === undefined)) return json({ error: "Pick a day of the week", field: "weekday" }, 400);
  if (merged.cadence !== "weekly") merged.weekday = null;
  if (merged.cadence === "once" && !merged.run_on) return json({ error: "Pick a date", field: "run_on" }, 400);
  if (merged.cadence === "interval" && !merged.interval_hours) return json({ error: "Every 1 to 168 hours", field: "interval_hours" }, 400);
  if (merged.cadence !== "once") merged.run_on = null;
  if (merged.cadence !== "interval") merged.interval_hours = null;
  if (merged.status === "done" && v.value.status === undefined) merged.status = "paused";
  if (v.value.project_id) {
    const { data: p } = await a.db.from("projects").select("id").eq("id", v.value.project_id).eq("user_id", a.user.id).maybeSingle();
    if (!p) return json({ error: "Project not found", field: "project_id" }, 404);
  }
  const patch: Record<string, unknown> = { ...v.value, weekday: merged.weekday, run_on: merged.run_on ?? null, interval_hours: merged.interval_hours ?? null, status: merged.status, updated_at: new Date().toISOString() };
  const next = merged.status === "active" ? nextRunAt(merged) : null;
  if (merged.status === "active" && !next) return json({ error: "That time has already passed. Pick a new date or time.", field: "run_on" }, 400);
  patch.next_run_at = next ? next.toISOString() : null;
  const { data, error } = await a.db.from("scheduled_jobs").update(patch).eq("id", params.id).eq("user_id", a.user.id).select(JOB_COLS);
  if (error) return dbError(error, "Could not update the scheduled prompt");
  if (!data?.length) return notFound();
  if (v.value.status && v.value.status !== (cur as ScheduledJob).status)
    await logActivity(a.db, a.user.id, { category: "task", title: `${v.value.status === "paused" ? "Paused" : "Resumed"} scheduled prompt “${merged.title}”` });
  return json({ job: data[0] });
}

export async function DELETE(_req: Request, props: Ctx) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("scheduled_jobs").delete().eq("id", params.id).eq("user_id", a.user.id).select("id, title");
  if (error) return dbError(error, "Could not delete the scheduled prompt");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "task", title: `Deleted scheduled prompt “${(data[0] as { title: string }).title}”` });
  return json({ ok: true });
}
