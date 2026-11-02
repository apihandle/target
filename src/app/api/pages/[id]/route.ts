import { badRequest, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Hide/show a Page (published) or delete it. Owner only (RLS + explicit user filter). */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const b = await readJson(req);
  if (!b || typeof b.published !== "boolean") return badRequest("published must be true or false");
  const { data } = await a.db.from("pages").update({ published: b.published, updated_at: new Date().toISOString() }).eq("id", params.id).eq("user_id", a.user.id).select("id, published");
  if (!data?.length) return notFound();
  return json({ page: data[0] });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data } = await a.db.from("pages").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
