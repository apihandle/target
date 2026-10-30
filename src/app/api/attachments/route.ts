import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET, extractText, isOwnStoragePath, validateUpload } from "@/lib/attachments";
import { checkLimit, LIMITS, tooMany } from "@/lib/connectors/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Register a file the browser has just uploaded to the private "chat-attachments" bucket
 * (storage policies only let a user write under their own "<user id>/" folder).
 * The server downloads it with the user's own session, checks type, size and content,
 * extracts text, and records it. Anything that fails validation is deleted from storage.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await checkLimit(LIMITS.upload(a.user.id)))) return tooMany();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const path = body.path;
  if (!isOwnStoragePath(path, a.user.id)) return json({ error: "File not found" }, 404);

  const bucket = a.db.storage.from(ATTACHMENT_BUCKET);
  const { data: blob, error: dlErr } = await bucket.download(path);
  if (dlErr || !blob) return json({ error: "File not found" }, 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const v = validateUpload({ name: body.name ?? path.split("/").pop(), bytes });
  if (!v.ok) {
    await bucket.remove([path]).catch(() => undefined);
    return json({ error: v.error }, v.status);
  }
  const extracted = await extractText(bytes, v.kind);
  const { data, error } = await a.db.from("attachments").insert({
    user_id: a.user.id, storage_path: path, name: v.name, mime: v.mime, kind: v.kind, size_bytes: bytes.byteLength, extracted_text: extracted,
  }).select("id, name, kind, mime, size_bytes").single();
  if (error || !data) {
    await bucket.remove([path]).catch(() => undefined);
    return dbError(error, "Could not save the attachment");
  }
  return json({ attachment: data, readable: v.kind === "image" || !!extracted }, 201);
}
