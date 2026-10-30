import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { MAX_MEMORY_LEN, cleanFact } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  const raw = typeof body?.content === "string" ? body.content.trim() : "";
  if (raw.length > MAX_MEMORY_LEN) return badRequest("Too long");
  const content = cleanFact(raw);
  if (content.length < 2) return badRequest("Memory can't be empty");
  const { data, error } = await a.db.from("memories").update({ content, source: "manual" }).eq("id", params.id).eq("user_id", a.user.id).select("id, content, source, created_at");
  if (error) return dbError(error, "Could not save");
  if (!data?.length) return notFound();
  return json({ memory: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data, error } = await a.db.from("memories").delete().eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (error) return dbError(error, "Could not delete");
  if (!data?.length) return notFound();
  return json({ ok: true });
}
