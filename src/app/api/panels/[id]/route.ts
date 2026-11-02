import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { PANEL_COLS, validatePanelPatch, type PanelKind } from "@/lib/panels";
import { isUuid } from "@/lib/ids";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** Edit title, description, structured items or manual config. Kind and data source can't change here. */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const { data: cur } = await a.db.from("panels").select("kind, config").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!cur) return notFound();
  const v = validatePanelPatch(cur.kind as PanelKind, (cur.config ?? {}) as Record<string, string>, body);
  if (!v.ok) return badRequest(v.error);
  const { data, error } = await a.db.from("panels").update({ ...v.value, updated_at: new Date().toISOString() }).eq("id", params.id).eq("user_id", a.user.id).select(PANEL_COLS);
  if (error) return dbError(error, "Could not save panel");
  if (!data?.length) return notFound();
  return json({ panel: data[0] });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("panels").delete().eq("id", params.id).eq("user_id", a.user.id).select("id, title");
  if (error) return dbError(error, "Could not remove panel");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "panel", title: `Panel removed: “${data[0].title}”` });
  return json({ ok: true });
}
