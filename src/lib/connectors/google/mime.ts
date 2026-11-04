import { z } from "zod";
import { ConnectorError } from "@/lib/connectors/http";
import { safeFetch } from "@/lib/server/safeFetch";
import type { ToolContext } from "@/lib/connectors/types";
import { fileId, gcall, oneLine } from "@/lib/connectors/google/shared";

/** RFC 2047 encoded-word for non-ASCII header text (Hindi subjects, names). */
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const b64lines = (b: Buffer) => b.toString("base64").replace(/(.{76})/g, "$1\r\n");

/** Comma/semicolon separated addresses -> a clean, de-duplicated list (null when any entry is not an email). */
export function parseAddresses(raw: string | undefined, max = 10): string[] | null {
  if (!raw || !raw.trim()) return [];
  const list = raw.split(/[,;]/).map((x) => oneLine(x)).filter(Boolean);
  const email = z.string().email();
  if (list.length > max || list.some((x) => !email.safeParse(x).success)) return null;
  return Array.from(new Set(list.map((x) => x.toLowerCase())));
}
export const addressList = (max: number) => z.string().max(4000).refine((v) => !!parseAddresses(v, max), { message: `Up to ${max} valid email addresses, separated by commas` });

export type Attachment = { filename: string; mimeType: string; data: Buffer };
export type Mail = {
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string;
  inReplyTo?: string; references?: string; attachments?: Attachment[];
};

const safeName = (n: string) => oneLine(n).replace(/["\\]/g, "_").slice(0, 200) || "attachment";
const mimeType = (t: string) => (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(t) ? t : "application/octet-stream");
const msgIdHeader = (s: string) => oneLine(s).replace(/[^\x21-\x7e ]/g, "").slice(0, 900);

/** The raw RFC 5322 message, UTF-8 safe (base64 body), with header injection stripped. Attachments make it multipart/mixed. */
export function buildMime(a: Mail): string {
  const lines = [
    ...(a.to.length ? [`To: ${a.to.join(", ")}`] : []),
    ...(a.cc?.length ? [`Cc: ${a.cc.join(", ")}`] : []),
    ...(a.bcc?.length ? [`Bcc: ${a.bcc.join(", ")}`] : []),
    `Subject: ${encHeader(oneLine(a.subject))}`,
    ...(a.inReplyTo ? [`In-Reply-To: ${msgIdHeader(a.inReplyTo)}`] : []),
    ...(a.references ? [`References: ${msgIdHeader(a.references)}`] : []),
    "MIME-Version: 1.0",
  ];
  const text = b64lines(Buffer.from(a.body, "utf8"));
  if (!a.attachments?.length) {
    lines.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
    return `${lines.join("\r\n")}\r\n\r\n${text}`;
  }
  const boundary = `=_target_${Math.random().toString(36).slice(2)}`;
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${text}`,
    ...a.attachments.map((f) => {
      const name = safeName(f.filename);
      const ascii = /^[\x20-\x7e]*$/.test(name);
      const disp = ascii ? `attachment; filename="${name}"` : `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
      return `--${boundary}\r\nContent-Type: ${mimeType(f.mimeType)}; name="${ascii ? name : encHeader(name)}"\r\nContent-Disposition: ${disp}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(f.data)}`;
    }),
  ];
  return `${lines.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--`;
}

// ------------------------------------------------------------------ attachments from Drive or a link

export const MAX_ATTACH_BYTES = 24 * 1024 * 1024;
export const attachmentInput = z.object({
  drive_file_id: fileId.optional().describe("A Google Drive file (Docs/Sheets/Slides are attached as PDF)"),
  url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "http(s) links only").optional().describe("A public link to download and attach"),
  filename: z.string().min(1).max(200).optional().describe("Optional file name to use"),
}).refine((a) => !!a.drive_file_id !== !!a.url, "Give drive_file_id or url (one per attachment)");
export const attachmentsInput = z.array(attachmentInput).max(10).optional().describe("Files to attach: from Google Drive (drive_file_id) or a public link (url)");
export type AttachmentRef = z.infer<typeof attachmentInput>;

const EXPORT_PDF = new Set(["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation", "application/vnd.google-apps.drawing"]);
const DRIVE = "https://www.googleapis.com/drive/v3/files";

async function fromDrive(ctx: ToolContext, id: string, name?: string): Promise<Attachment> {
  const meta = await gcall<{ name?: string; mimeType?: string; size?: string }>(ctx, `${DRIVE}/${id}?fields=name,mimeType,size&supportsAllDrives=true`);
  const mt = meta.mimeType ?? "application/octet-stream";
  if (mt === "application/vnd.google-apps.folder") throw new ConnectorError("That Drive item is a folder; attach files instead.", 400, "invalid");
  if (EXPORT_PDF.has(mt)) {
    const data = await gcall<Buffer>(ctx, `${DRIVE}/${id}/export?mimeType=application%2Fpdf`, { as: "bytes", maxBytes: MAX_ATTACH_BYTES });
    const base = (name ?? meta.name ?? "document").replace(/\.pdf$/i, "");
    return { filename: `${base}.pdf`, mimeType: "application/pdf", data };
  }
  if (mt.startsWith("application/vnd.google-apps.")) throw new ConnectorError(`“${meta.name}” is a Google ${mt.split(".").pop()} and can't be attached.`, 400, "invalid");
  if (Number(meta.size ?? 0) > MAX_ATTACH_BYTES) throw new ConnectorError(`“${meta.name}” is larger than 24 MB; share it with drive_share instead.`, 413, "invalid");
  const data = await gcall<Buffer>(ctx, `${DRIVE}/${id}?alt=media&supportsAllDrives=true`, { as: "bytes", maxBytes: MAX_ATTACH_BYTES });
  return { filename: name ?? meta.name ?? "file", mimeType: mt, data };
}

/** Download a user-supplied link through the SSRF guard (every redirect hop is re-checked). */
export async function downloadUrl(raw: string, maxBytes = MAX_ATTACH_BYTES): Promise<{ data: Buffer; mimeType: string; filename: string }> {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    let r: Response;
    try {
      r = await safeFetch(url, { timeoutMs: 20000, maxBytes, headers: { "User-Agent": "TARGET/1.0 (+https://gettarget.vercel.app)" } });
    } catch (e) {
      const blocked = e instanceof Error && /private|local/i.test(e.message);
      throw new ConnectorError(blocked ? "That link points to a private or local address, so it can't be used." : "Couldn't download that link.", 400, "invalid");
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      await r.body?.cancel().catch(() => undefined);
      if (!loc) break;
      url = new URL(loc, url).toString();
      continue;
    }
    if (!r.ok) throw new ConnectorError(`That link returned ${r.status}.`, 400, "invalid");
    let data: Buffer;
    try { data = Buffer.from(await r.arrayBuffer()); } catch { throw new ConnectorError(`That file is larger than ${Math.round(maxBytes / 1048576)} MB.`, 413, "invalid"); }
    const cd = r.headers.get("content-disposition") ?? "";
    const fromCd = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1];
    let fromPath = "";
    try { fromPath = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""); } catch { fromPath = ""; }
    const filename = (fromCd ? decodeURIComponent(fromCd) : fromPath) || "download";
    return { data, mimeType: (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim(), filename };
  }
  throw new ConnectorError("That link redirects too many times.", 400, "invalid");
}

/** Fetch every attachment; total capped at 24 MB (Gmail's limit is 25 MB). */
export async function resolveAttachments(ctx: ToolContext, refs: AttachmentRef[] | undefined): Promise<Attachment[]> {
  const out: Attachment[] = [];
  let total = 0;
  for (const ref of refs ?? []) {
    const a = ref.drive_file_id ? await fromDrive(ctx, ref.drive_file_id, ref.filename) : await (async () => { const d = await downloadUrl(ref.url!); return { filename: ref.filename ?? d.filename, mimeType: d.mimeType, data: d.data }; })();
    total += a.data.length;
    if (total > MAX_ATTACH_BYTES) throw new ConnectorError("The attachments add up to more than 24 MB. Share large files from Drive instead.", 413, "invalid");
    out.push(a);
  }
  return out;
}

/** Names for the approval card (Drive names are looked up; links show their address). */
export async function describeAttachments(ctx: ToolContext, refs: AttachmentRef[] | undefined): Promise<string> {
  const names: string[] = [];
  for (const ref of refs ?? []) {
    if (ref.drive_file_id) {
      const m = await gcall<{ name?: string; mimeType?: string }>(ctx, `${DRIVE}/${ref.drive_file_id}?fields=name,mimeType&supportsAllDrives=true`);
      names.push(`${ref.filename ?? m.name ?? ref.drive_file_id}${EXPORT_PDF.has(m.mimeType ?? "") ? " (as PDF)" : ""} — from Drive`);
    } else names.push(`${ref.filename ?? ref.url!.split("/").pop()?.slice(0, 80) ?? "file"} — from ${ref.url!.slice(0, 200)}`);
  }
  return names.join("\n");
}
