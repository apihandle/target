import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { PROJECT_COLS, validateProject } from "@/lib/projects";
import { isUuid } from "@/lib/ids";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateProject(body, true);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const { data: cur } = await a.db.from("projects").select("name, status").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!cur) return notFound();
  const patch: Record<string, unknown> = { ...v.value, updated_at: new Date().toISOString() };
  if (v.value.status) patch.archived_at = v.value.status === "archived" ? new Date().toISOString() : null;
  const { data, error } = await a.db.from("projects").update(patch).eq("id", params.id).eq("user_id", a.user.id).select(PROJECT_COLS);
  if (error) return dbError(error, "Could not save project");
  if (!data?.length) return notFound();
  const name = v.value.name ?? (cur.name as string);
  if (v.value.status && v.value.status !== cur.status)
    await logActivity(a.db, a.user.id, { category: "project", title: v.value.status === "archived" ? `Archived “${name}”` : cur.status === "archived" ? `Restored “${name}”` : `“${name}” is now ${v.value.status}`, status: v.value.status, project_id: params.id });
  else if (v.value.name && v.value.name !== cur.name)
    await logActivity(a.db, a.user.id, { category: "project", title: `Renamed “${cur.name}” to “${v.value.name}”`, project_id: params.id });
  return json({ project: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("projects").delete().eq("id", params.id).eq("user_id", a.user.id).select("id, name");
  if (error) return dbError(error, "Could not delete project");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "project", title: `Deleted project “${data[0].name}”`, detail: "Its chats and tasks were kept, without a project." });
  return json({ ok: true });
}
