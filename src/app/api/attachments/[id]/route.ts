import { dbError, json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Remove an attachment that hasn't been sent yet (the ✕ on a chip before sending). */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data: row } = await a.db.from("attachments").select("id, storage_path, message_id").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!row) return notFound();
  if (row.message_id) return json({ error: "This file is part of a sent message. Delete the chat to remove it." }, 409);
  const { error } = await a.db.from("attachments").delete().eq("id", params.id).eq("user_id", a.user.id);
  if (error) return dbError(error, "Could not remove the attachment");
  await a.db.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path as string]).catch(() => undefined);
  return json({ ok: true });
}
