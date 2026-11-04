import { z } from "zod";
import { clip, tool } from "@/lib/connectors/define";
import { ConnectorError } from "@/lib/connectors/http";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";
import { NEED, type GTool, bytesToText, fileId, folderId, gcall, human, multipartRelated, oneLine, qs, str } from "@/lib/connectors/google/shared";
import { downloadUrl } from "@/lib/connectors/google/mime";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed,shared,owners(emailAddress)";
const ALL = "supportsAllDrives=true";
const MT = {
  folder: "application/vnd.google-apps.folder", doc: "application/vnd.google-apps.document", sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation", drawing: "application/vnd.google-apps.drawing",
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

type File = { id?: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string; webViewLink?: string; webContentLink?: string; parents?: string[]; trashed?: boolean; shared?: boolean; owners?: { emailAddress?: string }[] };
const view = (f: File) => ({
  id: f.id, name: f.name, type: f.mimeType === MT.folder ? "folder" : f.mimeType, ...(f.size ? { size: human(f.size) } : {}),
  modified: f.modifiedTime, link: f.webViewLink, ...(f.parents ? { parents: f.parents } : {}), ...(f.trashed ? { trashed: true } : {}), ...(f.shared ? { shared: true } : {}),
  ...(f.owners?.length ? { owner: f.owners[0].emailAddress } : {}),
});
const meta = (ctx: ToolContext, id: string, fields = FIELDS) => gcall<File>(ctx, `${FILES}/${id}?fields=${fields}&${ALL}`);

async function upload(ctx: ToolContext, m: Record<string, unknown>, data: Buffer, type: string): Promise<File> {
  return gcall<File>(ctx, `${UPLOAD}?uploadType=multipart&fields=${FIELDS}&${ALL}`, { method: "POST", body: multipartRelated(m, data, type), timeoutMs: 90000 });
}

/** Tiny Markdown → HTML for Google Docs import (headings, bold/italic, links, lists, paragraphs). Input is escaped first. */
export function markdownToHtml(md: string): string {
  const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => escH(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, "%22")}">${t}</a>`);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line), ul = /^\s*[-*+]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) { close(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (ul) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return `<html><head><meta charset="utf-8"></head><body>${out.join("\n")}</body></html>`;
}

/** CSV with quoting, for creating Sheets from rows. */
export function toCsv(rows: (string | number | boolean | null)[][]): string {
  return rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n");
}

const EXPORT: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation", rtf: "application/rtf", txt: "text/plain", csv: "text/csv", html: "text/html", epub: "application/epub+zip", png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml",
};
const TEXTUAL = new Set(["txt", "csv", "html", "svg"]);
const files = z.array(fileId).min(1).max(50);

async function namesOf(ctx: ToolContext, list: string[]): Promise<{ text: string; metas: File[] }> {
  const metas = await Promise.all(list.map((id) => meta(ctx, id, "id,name,mimeType,trashed,owners(emailAddress),shared")));
  return { metas, text: metas.slice(0, 15).map((f) => `• ${f.name}${f.mimeType === MT.folder ? " (folder, with everything in it)" : ""}`).join("\n") + (metas.length > 15 ? `\n…and ${metas.length - 15} more` : "") };
}

export const DRIVE_TOOLS: GTool[] = [
  { need: NEED.driveRead, ...tool({
    name: "drive_search",
    description: "Search Google Drive by text inside files and names (optionally only names, a type, or one folder). Returns id, name, type, size, modified time and link.",
    input: z.object({
      query: z.string().min(1).max(200), name_only: z.boolean().default(false),
      type: z.enum(["any", "folder", "document", "spreadsheet", "presentation", "pdf", "image"]).default("any"), folder_id: folderId.optional(),
      max: z.number().int().min(1).max(50).default(10),
    }),
    async execute(a, ctx) {
      const types: Record<string, string> = { folder: `mimeType = '${MT.folder}'`, document: `mimeType = '${MT.doc}'`, spreadsheet: `mimeType = '${MT.sheet}'`, presentation: `mimeType = '${MT.slides}'`, pdf: "mimeType = 'application/pdf'", image: "mimeType contains 'image/'" };
      const q = [a.name_only ? `name contains '${esc(a.query)}'` : `fullText contains '${esc(a.query)}'`, "trashed = false", types[a.type], a.folder_id && `'${a.folder_id}' in parents`].filter(Boolean).join(" and ");
      const j = await gcall<{ files?: File[] }>(ctx, `${FILES}${qs({ pageSize: a.max, fields: `files(${FIELDS})`, q, includeItemsFromAllDrives: "true", supportsAllDrives: "true" })}`);
      return (j.files ?? []).map(view);
    },
  }) },
  { need: NEED.driveRead, ...tool({
    name: "drive_list_folder",
    description: "List what's inside a Drive folder (\"root\" = My Drive), folders first. Use page_token for more.",
    input: z.object({ folder_id: folderId.default("root"), max: z.number().int().min(1).max(100).default(50), page_token: z.string().max(500).optional() }),
    async execute(a, ctx) {
      const j = await gcall<{ files?: File[]; nextPageToken?: string }>(ctx, `${FILES}${qs({ pageSize: a.max, pageToken: a.page_token, orderBy: "folder,name", fields: `nextPageToken,files(${FIELDS})`, q: `'${a.folder_id}' in parents and trashed = false`, includeItemsFromAllDrives: "true", supportsAllDrives: "true" })}`);
      return { files: (j.files ?? []).map(view), ...(j.nextPageToken ? { next_page_token: j.nextPageToken } : {}) };
    },
  }) },
  { need: NEED.driveRead, ...tool({
    name: "drive_get_file",
    description: "Details of one Drive file or folder: name, type, size, owner, folder, link, and who it's shared with.",
    input: z.object({ file_id: fileId }),
    async execute(a, ctx) {
      const f = await meta(ctx, a.file_id, `${FIELDS},webContentLink,permissions(emailAddress,role,type,domain)`) as File & { permissions?: { emailAddress?: string; role?: string; type?: string; domain?: string }[] };
      return { ...view(f), download_link: f.webContentLink, shared_with: (f.permissions ?? []).map((p) => ({ who: p.emailAddress ?? (p.type === "anyone" ? "anyone with the link" : p.domain ?? p.type), role: p.role })) };
    },
  }) },
  { need: NEED.driveRead, ...tool({
    name: "drive_read",
    description: "Read the text of a Drive file: Google Docs/Sheets/Slides (exported as text/CSV), PDFs and text files.",
    input: z.object({ file_id: fileId }),
    async execute(a, ctx) {
      const m = await meta(ctx, a.file_id, "name,mimeType,size");
      const mt = m.mimeType ?? "";
      const exportAs: Record<string, string> = { [MT.doc]: "text/plain", [MT.sheet]: "text/csv", [MT.slides]: "text/plain" };
      if (exportAs[mt]) {
        const text = await gcall<string>(ctx, `${FILES}/${a.file_id}/export?mimeType=${encodeURIComponent(exportAs[mt])}`, { as: "text" });
        return { name: m.name, mimeType: mt, content: clip(String(text), 20000) };
      }
      if (mt === MT.folder) return { name: m.name, mimeType: mt, note: "This is a folder; use drive_list_folder." };
      if (mt.startsWith("application/vnd.google-apps.") || Number(m.size ?? 0) > 20 * 1024 * 1024) return { name: m.name, mimeType: mt, note: "Only details are available for this file (not a readable type, or larger than 20 MB)." };
      const bytes = await gcall<Buffer>(ctx, `${FILES}/${a.file_id}?alt=media&${ALL}`, { as: "bytes", maxBytes: 20 * 1024 * 1024 });
      const text = await bytesToText(bytes, mt, m.name);
      if (text === null) return { name: m.name, mimeType: mt, note: "Binary file; no readable text (images and Office files: open the link)." };
      return { name: m.name, mimeType: mt, content: clip(text, 20000) };
    },
  }) },
  { need: NEED.driveCreate, ...tool({
    name: "drive_create_folder",
    description: "Create a folder in Google Drive (inside another folder, or My Drive).",
    input: z.object({ name: z.string().min(1).max(200), parent_id: folderId.optional() }),
    async execute(a, ctx) {
      const f = await gcall<File>(ctx, `${FILES}?fields=${FIELDS}&${ALL}`, { method: "POST", body: { json: { name: oneLine(a.name), mimeType: MT.folder, ...(a.parent_id ? { parents: [a.parent_id] } : {}) } } });
      return { created: true, ...view(f) };
    },
  }) },
  { need: NEED.driveCreate, ...tool({
    name: "drive_upload_file",
    description: "Save a file to Google Drive from text you write (content) or from a public link (url), optionally into a folder. convert: \"doc\"/\"sheet\" turns text/CSV/Office files into Google Docs/Sheets.",
    input: z.object({
      name: z.string().min(1).max(200), content: z.string().max(5_000_000).optional(), url: z.string().url().max(2000).optional(),
      mime_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i).optional().describe("e.g. text/plain, text/csv, text/markdown"),
      folder_id: folderId.optional(), convert: z.enum(["none", "doc", "sheet", "slides"]).default("none"),
    }).refine((a) => (a.content !== undefined) !== !!a.url, "Give content or url"),
    async execute(a, ctx) {
      let data: Buffer, type: string;
      if (a.url) { const d = await downloadUrl(a.url); data = d.data; type = a.mime_type ?? d.mimeType; }
      else { data = Buffer.from(a.content ?? "", "utf8"); type = a.mime_type ?? (/\.csv$/i.test(a.name) ? "text/csv" : /\.md$/i.test(a.name) ? "text/markdown" : /\.html?$/i.test(a.name) ? "text/html" : /\.json$/i.test(a.name) ? "application/json" : "text/plain"); }
      const target = { doc: MT.doc, sheet: MT.sheet, slides: MT.slides, none: undefined }[a.convert];
      const f = await upload(ctx, { name: oneLine(a.name), ...(a.folder_id ? { parents: [a.folder_id] } : {}), ...(target ? { mimeType: target } : {}) }, data, type);
      return { uploaded: true, ...view(f) };
    },
  }) },
  { need: NEED.driveCreate, ...tool({
    name: "drive_create_doc",
    description: "Create a Google Doc with content (Markdown headings, **bold**, *italic*, lists and links are kept), optionally in a folder. Returns its link.",
    input: z.object({ title: z.string().min(1).max(200), content: z.string().max(1_000_000).default(""), folder_id: folderId.optional() }),
    async execute(a, ctx) {
      const f = await upload(ctx, { name: oneLine(a.title), mimeType: MT.doc, ...(a.folder_id ? { parents: [a.folder_id] } : {}) }, Buffer.from(markdownToHtml(a.content), "utf8"), "text/html");
      return { created: true, ...view(f) };
    },
  }) },
  { need: NEED.driveCreate, ...tool({
    name: "drive_create_sheet",
    description: "Create a Google Sheet filled with rows (first row = headers), optionally in a folder. Returns its id and link (add more with sheets_append_rows).",
    input: z.object({ title: z.string().min(1).max(200), rows: z.array(z.array(z.union([z.string().max(50000), z.number(), z.boolean(), z.null()])).max(200)).max(20000).default([]), folder_id: folderId.optional() }),
    async execute(a, ctx) {
      const f = await upload(ctx, { name: oneLine(a.title), mimeType: MT.sheet, ...(a.folder_id ? { parents: [a.folder_id] } : {}) }, Buffer.from(toCsv(a.rows), "utf8"), "text/csv");
      return { created: true, rows: a.rows.length, ...view(f) };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_move",
    description: "Move a Drive file or folder into another folder (\"root\" = My Drive).",
    input: z.object({ file_id: fileId, folder_id: folderId }),
    async execute(a, ctx) {
      const m = await meta(ctx, a.file_id, "id,name,parents");
      const remove = (m.parents ?? []).filter((p) => p !== a.folder_id).join(",");
      const f = await gcall<File>(ctx, `${FILES}/${a.file_id}${qs({ addParents: a.folder_id, removeParents: remove, fields: FIELDS, supportsAllDrives: "true" })}`, { method: "PATCH", body: { json: {} } });
      return { moved: true, ...view(f) };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_rename",
    description: "Rename a Drive file or folder.",
    input: z.object({ file_id: fileId, name: z.string().min(1).max(200) }),
    async execute(a, ctx) {
      const f = await gcall<File>(ctx, `${FILES}/${a.file_id}?fields=${FIELDS}&${ALL}`, { method: "PATCH", body: { json: { name: oneLine(a.name) } } });
      return { renamed: true, ...view(f) };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_copy",
    description: "Make a copy of a Drive file (optionally with a new name, in another folder).",
    input: z.object({ file_id: fileId, name: z.string().min(1).max(200).optional(), folder_id: folderId.optional() }),
    async execute(a, ctx) {
      const f = await gcall<File>(ctx, `${FILES}/${a.file_id}/copy?fields=${FIELDS}&${ALL}`, { method: "POST", body: { json: { ...(a.name ? { name: oneLine(a.name) } : {}), ...(a.folder_id ? { parents: [a.folder_id] } : {}) } } });
      return { copied: true, ...view(f) };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_share",
    description: "Share a Drive file or folder with someone (reader, commenter or writer), or turn on \"anyone with the link\". Needs the user's approval: the card shows the file, who gets access and the role.",
    input: z.object({
      file_id: fileId, email: z.string().email().optional(), anyone_with_link: z.boolean().default(false),
      role: z.enum(["reader", "commenter", "writer"]).default("reader"), notify: z.boolean().default(true), message: z.string().max(1000).optional(),
    }).refine((a) => !!a.email !== a.anyone_with_link, "Give an email, or anyone_with_link: true"),
    requiresApproval: true,
    summarize: (a) => `Share a Drive file with ${a.anyone_with_link ? "anyone with the link" : a.email} (${a.role})`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const f = await meta(ctx, a.file_id, "id,name,mimeType,shared,webViewLink");
      const role = { reader: "Can view", commenter: "Can comment", writer: "Can edit" }[a.role];
      return {
        summary: `Share “${oneLine(str(f.name)).slice(0, 100)}” with ${a.anyone_with_link ? "anyone with the link" : a.email}`,
        details: { File: `${f.name}${f.mimeType === MT.folder ? " (folder, with everything in it)" : ""}`, "Who": a.anyone_with_link ? "Anyone with the link" : str(a.email), Access: role, ...(a.email ? { Notify: a.notify ? "Yes, Google emails them" : "No" } : {}), ...(a.message ? { Message: a.message } : {}) },
        ...(a.anyone_with_link ? { warning: "Anyone who gets the link can open it, without signing in." } : a.role === "writer" ? { warning: "They will be able to edit and re-share it." } : {}),
      };
    },
    async execute(a, ctx) {
      const body = a.anyone_with_link ? { type: "anyone", role: a.role } : { type: "user", role: a.role, emailAddress: a.email };
      await gcall(ctx, `${FILES}/${a.file_id}/permissions${qs({ supportsAllDrives: "true", ...(a.email ? { sendNotificationEmail: a.notify ? "true" : "false", emailMessage: a.notify ? a.message : undefined } : {}) })}`, { method: "POST", body: { json: body } });
      const f = await meta(ctx, a.file_id, "id,name,webViewLink");
      return { shared: true, with: a.anyone_with_link ? "anyone with the link" : a.email, role: a.role, link: f.webViewLink };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_unshare",
    description: "Remove someone's access to a Drive file (or turn off \"anyone with the link\"). Needs the user's approval.",
    input: z.object({ file_id: fileId, email: z.string().email().optional(), anyone_with_link: z.boolean().default(false) }).refine((a) => !!a.email !== a.anyone_with_link, "Give an email, or anyone_with_link: true"),
    requiresApproval: true,
    summarize: (a) => `Remove ${a.anyone_with_link ? "link sharing" : `${a.email}'s access`} from a Drive file`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const f = await meta(ctx, a.file_id, "id,name");
      return { summary: `Stop sharing “${oneLine(str(f.name)).slice(0, 100)}” with ${a.anyone_with_link ? "anyone with the link" : a.email}`, details: { File: str(f.name), Remove: a.anyone_with_link ? "Anyone with the link" : str(a.email) } };
    },
    async execute(a, ctx) {
      const j = await gcall<{ permissions?: { id: string; type?: string; emailAddress?: string; role?: string }[] }>(ctx, `${FILES}/${a.file_id}/permissions?fields=permissions(id,type,emailAddress,role)&${ALL}`);
      const hits = (j.permissions ?? []).filter((p) => (a.anyone_with_link ? p.type === "anyone" : str(p.emailAddress).toLowerCase() === str(a.email).toLowerCase()) && p.role !== "owner");
      if (!hits.length) return { removed: 0, note: "That person/link didn't have access." };
      for (const p of hits) await gcall(ctx, `${FILES}/${a.file_id}/permissions/${p.id}?${ALL}`, { method: "DELETE" });
      return { removed: hits.length };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_trash",
    description: "Move Drive files or folders to the Trash (recoverable for 30 days with drive_untrash). Needs the user's approval: the card lists them.",
    input: z.object({ file_ids: files }),
    requiresApproval: true,
    summarize: (a) => `Move ${a.file_ids.length} Drive item${a.file_ids.length > 1 ? "s" : ""} to the Trash`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const { text } = await namesOf(ctx, a.file_ids);
      return { details: { Files: text, Count: String(a.file_ids.length) }, warning: "Drive keeps trashed files for 30 days, then deletes them for good." };
    },
    async execute(a, ctx) {
      for (const id of a.file_ids) await gcall(ctx, `${FILES}/${id}?${ALL}`, { method: "PATCH", body: { json: { trashed: true } } });
      return { trashed: a.file_ids.length, note: "In Drive's Trash for 30 days (drive_untrash restores)." };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_untrash",
    description: "Restore Drive files or folders from the Trash.",
    input: z.object({ file_ids: files }),
    async execute(a, ctx) {
      for (const id of a.file_ids) await gcall(ctx, `${FILES}/${id}?${ALL}`, { method: "PATCH", body: { json: { trashed: false } } });
      return { restored: a.file_ids.length };
    },
  }) },
  { need: NEED.driveWrite, ...tool({
    name: "drive_delete_permanently",
    description: "Delete Drive files or folders forever (skips the Trash; can't be undone). Only when the user clearly asks for permanent deletion; otherwise use drive_trash. Needs the user's approval.",
    input: z.object({ file_ids: files }),
    requiresApproval: true,
    summarize: (a) => `Permanently delete ${a.file_ids.length} Drive item${a.file_ids.length > 1 ? "s" : ""}`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const { text } = await namesOf(ctx, a.file_ids);
      return { details: { Files: text, Count: String(a.file_ids.length) }, warning: "This deletes them forever. They can't be recovered from the Trash." };
    },
    async execute(a, ctx) {
      for (const id of a.file_ids) await gcall(ctx, `${FILES}/${id}?${ALL}`, { method: "DELETE" });
      return { deleted: a.file_ids.length };
    },
  }) },
  { need: NEED.driveCreate, ...tool({
    name: "drive_export",
    description: "Export a Google Doc/Sheet/Slides/Drawing to PDF, DOCX, XLSX, PPTX, CSV, TXT, HTML, EPUB, ODT, PNG… The exported file is saved next to the original in Drive and its link returned (text formats also return the text).",
    input: z.object({ file_id: fileId, format: z.enum(Object.keys(EXPORT) as [string, ...string[]]).default("pdf"), save_to_drive: z.boolean().default(true), folder_id: folderId.optional() }),
    async execute(a, ctx) {
      const m = await meta(ctx, a.file_id, "id,name,mimeType,parents");
      if (!str(m.mimeType).startsWith("application/vnd.google-apps.") || m.mimeType === MT.folder) throw new ConnectorError(`“${m.name}” isn't a Google Doc/Sheet/Slides file, so it can't be exported. drive_get_file gives its download link.`, 400, "invalid");
      const type = EXPORT[a.format];
      const data = await gcall<Buffer>(ctx, `${FILES}/${a.file_id}/export?mimeType=${encodeURIComponent(type)}`, { as: "bytes", maxBytes: 10 * 1024 * 1024 });
      const text = TEXTUAL.has(a.format) ? clip(data.toString("utf8"), 20000) : undefined;
      if (!a.save_to_drive) return { name: m.name, format: a.format, size: human(data.length), ...(text ? { content: text } : { note: "Set save_to_drive: true to get a file link." }) };
      const parents = a.folder_id ? [a.folder_id] : m.parents?.length ? [m.parents[0]] : undefined;
      const f = await gcall<File>(ctx, `${UPLOAD}?uploadType=multipart&fields=${FIELDS},webContentLink&${ALL}`, { method: "POST", body: multipartRelated({ name: `${str(m.name).replace(/\.[a-z0-9]{2,5}$/i, "")}.${a.format}`, ...(parents ? { parents } : {}) }, data, type), timeoutMs: 90000 });
      return { exported: true, format: a.format, size: human(data.length), ...view(f), download_link: f.webContentLink, ...(text ? { content: text } : {}) };
    },
  }) },
];
