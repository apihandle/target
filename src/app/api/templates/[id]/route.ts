import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { TEMPLATE_COLS, validateTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, props: Ctx) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateTemplate(body, true);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const { data, error } = await a.db.from("prompt_templates").update({ ...v.value, updated_at: new Date().toISOString() }).eq("id", params.id).eq("user_id", a.user.id).select(TEMPLATE_COLS);
  if (error) return dbError(error, "Could not update the template");
  if (!data?.length) return notFound();
  return json({ template: data[0] });
}

export async function DELETE(_req: Request, props: Ctx) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("prompt_templates").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (error) return dbError(error, "Could not delete the template");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
