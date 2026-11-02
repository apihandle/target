import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { cleanText, isUuid } from "@/lib/ids";
import { removeConversationFiles } from "@/lib/server/attachments";

export const dynamic = "force-dynamic";

/** Rename and/or pin a chat. Body: { title?: string, pinned?: boolean }. */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined || body.pinned === undefined) {
    const title = cleanText(body.title, 81);
    if (!title || title.length > 80) return badRequest("Title must be 1–80 characters");
    patch.title = title;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") return badRequest("pinned must be true or false");
    patch.pinned = body.pinned;
    patch.pinned_at = body.pinned ? new Date().toISOString() : null;
  }
  const cols = patch.pinned !== undefined ? "id, title, pinned" : "id, title";
  const { data, error } = await a.db.from("conversations").update(patch).eq("id", params.id).eq("user_id", a.user.id).select(cols);
  if (error) return dbError(error, patch.pinned !== undefined ? "Could not pin chat" : "Could not rename chat");
  if (!data?.length) return notFound();
  return json({ conversation: data[0] });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data: owned } = await a.db.from("conversations").select("id").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!owned) return notFound();
  await removeConversationFiles(a.db, a.user.id, params.id);
  const { data, error } = await a.db.from("conversations").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (error) return dbError(error, "Could not delete chat");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
