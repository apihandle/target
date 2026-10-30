import type { Db } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET, MAX_ATTACHMENTS_PER_MESSAGE, MAX_VISION_IMAGE_BYTES, attachmentsBlock, type AttachmentKind, type ContextFile } from "@/lib/attachments";
import type { ContentPart } from "@/lib/llm";
import { isUuid } from "@/lib/ids";

export type AttachmentRow = {
  id: string; name: string; kind: AttachmentKind; mime: string; size_bytes: number; storage_path: string;
  extracted_text: string | null; conversation_id: string | null; message_id: string | null;
};
const COLS = "id, name, kind, mime, size_bytes, storage_path, extracted_text, conversation_id, message_id";

/** Parse the chat body's attachmentIds: up to 5 distinct uuids, or an error. */
export function parseAttachmentIds(v: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, ids: [] };
  if (!Array.isArray(v) || v.some((x) => !isUuid(x))) return { ok: false, error: "Attachment not found" };
  const ids = Array.from(new Set(v as string[]));
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false, error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message` };
  return { ok: true, ids };
}

/**
 * The new files for a message must all belong to the user, not be part of a sent message yet, and
 * not belong to a different chat. Returns null when any of them fails (reported as "not found").
 */
export async function claimableAttachments(db: Db, userId: string, ids: string[], conversationId?: string): Promise<AttachmentRow[] | null> {
  if (!ids.length) return [];
  const { data, error } = await db.from("attachments").select(COLS).in("id", ids).eq("user_id", userId);
  if (error) return null;
  const rows = (data ?? []) as AttachmentRow[];
  if (rows.length !== ids.length) return null;
  if (rows.some((r) => r.message_id || (r.conversation_id && r.conversation_id !== conversationId))) return null;
  return rows;
}

export async function linkAttachments(db: Db, userId: string, ids: string[], conversationId: string, messageId: string | null) {
  if (!ids.length) return;
  await db.from("attachments").update({ conversation_id: conversationId, message_id: messageId }).in("id", ids).eq("user_id", userId);
}

export async function conversationAttachments(db: Db, userId: string, conversationId: string): Promise<AttachmentRow[]> {
  try {
    const { data, error } = await db.from("attachments").select(COLS).eq("conversation_id", conversationId).eq("user_id", userId).order("created_at", { ascending: true }).limit(30);
    if (error) return [];
    return (data ?? []) as AttachmentRow[];
  } catch { return []; }
}

/**
 * Build the attachment context for a model request: the untrusted text block for the system prompt
 * and, for images on the current message, image parts for a vision model (when one is configured).
 */
export async function attachmentContext(db: Db, all: AttachmentRow[], currentIds: Set<string>, visionAvailable: boolean): Promise<{ block: string; imageParts: ContentPart[] }> {
  const files: ContextFile[] = all.map((r) => ({ name: r.name, kind: r.kind, extracted_text: r.extracted_text, current: currentIds.has(r.id) }));
  const images = all.filter((r) => r.kind === "image" && currentIds.has(r.id));
  const imageParts: ContentPart[] = [];
  const visionNames: string[] = [];
  const noVisionNames: string[] = [];
  for (const img of images) {
    if (!visionAvailable || img.size_bytes > MAX_VISION_IMAGE_BYTES) { noVisionNames.push(img.name); continue; }
    try {
      const { data: blob, error } = await db.storage.from(ATTACHMENT_BUCKET).download(img.storage_path);
      if (error || !blob) { noVisionNames.push(img.name); continue; }
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      imageParts.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${b64}` } });
      visionNames.push(img.name);
    } catch { noVisionNames.push(img.name); }
  }
  return { block: attachmentsBlock(files, { visionNames, noVisionNames }), imageParts };
}

/** Best-effort removal of every stored file in a chat (used before deleting the chat). */
export async function removeConversationFiles(db: Db, userId: string, conversationId: string) {
  try {
    const { data } = await db.from("attachments").select("storage_path").eq("conversation_id", conversationId).eq("user_id", userId);
    const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
    if (paths.length) await db.storage.from(ATTACHMENT_BUCKET).remove(paths);
  } catch { /* storage cleanup is best-effort */ }
}
