import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { cleanText, isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  const title = cleanText(body?.title, 81);
  if (!title || title.length > 80) return badRequest("Title must be 1–80 characters");
  const { data, error } = await a.db.from("conversations").update({ title }).eq("id", params.id).eq("user_id", a.user.id).select("id, title");
  if (error) return dbError(error, "Could not rename chat");
  if (!data?.length) return notFound();
  return json({ conversation: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("conversations").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (error) return dbError(error, "Could not delete chat");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
