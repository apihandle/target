import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { JOB_COLS, nextRunAt, validateJob, type ScheduledJob } from "@/lib/schedule";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Edit, pause or resume a scheduled prompt. next_run_at is recomputed whenever it's (re)activated or rescheduled. */
export async function PATCH(req: Request, { params }: Ctx) {
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
  if (merged.cadence === "daily") merged.weekday = null;
  if (v.value.project_id) {
    const { data: p } = await a.db.from("projects").select("id").eq("id", v.value.project_id).eq("user_id", a.user.id).maybeSingle();
    if (!p) return json({ error: "Project not found", field: "project_id" }, 404);
  }
  const patch: Record<string, unknown> = { ...v.value, weekday: merged.weekday, updated_at: new Date().toISOString() };
  patch.next_run_at = merged.status === "active" ? nextRunAt(merged).toISOString() : null;
  const { data, error } = await a.db.from("scheduled_jobs").update(patch).eq("id", params.id).eq("user_id", a.user.id).select(JOB_COLS);
  if (error) return dbError(error, "Could not update the scheduled prompt");
  if (!data?.length) return notFound();
  if (v.value.status && v.value.status !== (cur as ScheduledJob).status)
    await logActivity(a.db, a.user.id, { category: "task", title: `${v.value.status === "paused" ? "Paused" : "Resumed"} scheduled prompt “${merged.title}”` });
  return json({ job: data[0] });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("scheduled_jobs").delete().eq("id", params.id).eq("user_id", a.user.id).select("id, title");
  if (error) return dbError(error, "Could not delete the scheduled prompt");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "task", title: `Deleted scheduled prompt “${(data[0] as { title: string }).title}”` });
  return json({ ok: true });
}
