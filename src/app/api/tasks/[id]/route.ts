import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { STATUS_LABEL, TASK_COLS, canTransition, validateTaskPatch, type TaskStatus } from "@/lib/tasks";
import { isUuid } from "@/lib/ids";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateTaskPatch(body);
  if (!v.ok) return badRequest(v.error);
  const { data: cur } = await a.db.from("tasks").select("id, title, status, project_id").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!cur) return notFound();
  const from = cur.status as TaskStatus;
  if (v.value.status && !canTransition(from, v.value.status)) return json({ error: `Can't move a ${STATUS_LABEL[from].toLowerCase()} task to ${STATUS_LABEL[v.value.status].toLowerCase()}` }, 409);
  const patch: Record<string, unknown> = { ...v.value, updated_at: new Date().toISOString() };
  if (v.value.status) { patch.error = null; patch.progress = ""; }
  const { data, error } = await a.db.from("tasks").update(patch).eq("id", params.id).eq("user_id", a.user.id).select(TASK_COLS);
  if (error) return dbError(error, "Could not update task");
  if (!data?.length) return notFound();
  if (v.value.status && v.value.status !== from) {
    const done = v.value.status === "completed";
    await logActivity(a.db, a.user.id, {
      category: done ? "outcome" : "task", title: `${done ? "Completed" : STATUS_LABEL[v.value.status]}: “${(v.value.title ?? cur.title) as string}”`,
      detail: `Changed by you from ${STATUS_LABEL[from]}.`, status: v.value.status, task_id: params.id, project_id: cur.project_id as string | null,
    });
  }
  return json({ task: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("tasks").delete().eq("id", params.id).eq("user_id", a.user.id).select("id, title, project_id");
  if (error) return dbError(error, "Could not delete task");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "task", title: `Deleted task “${data[0].title}”`, project_id: data[0].project_id as string | null });
  return json({ ok: true });
}
