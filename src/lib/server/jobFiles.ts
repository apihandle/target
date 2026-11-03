import type { Db } from "@/lib/server/auth";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { SITE } from "@/lib/builtins/helpers";

const OUT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/** Files a code job saved into out/ become private downloads for the job's owner (max 5, 10 MB each). */
export async function storeJobFiles(db: Db, userId: string, raw: unknown): Promise<{ name: string; url: string }[]> {
  const files: { name: string; url: string }[] = [];
  if (!Array.isArray(raw)) return files;
  for (const f of (raw as { name?: unknown; base64?: unknown }[]).slice(0, 5)) {
    if (typeof f?.name !== "string" || typeof f.base64 !== "string") continue;
    const name = f.name.replace(/[^\w.\- ]/g, "_").slice(0, 100) || "file";
    const bytes = Buffer.from(f.base64, "base64");
    if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) continue;
    const mime = OUT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    const fid = crypto.randomUUID();
    const path = `${userId}/generated/${fid}-${name}`;
    const up = await db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (up.error) continue;
    const { error } = await db.from("generated_files").insert({ id: fid, user_id: userId, name, mime, size_bytes: bytes.byteLength, storage_path: path });
    if (!error) files.push({ name, url: `${SITE}/api/files/${fid}` });
  }
  return files;
}
