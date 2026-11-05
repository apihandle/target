import { z } from "zod";
import { clip, tool } from "@/lib/connectors/define";
import { ConnectorError } from "@/lib/connectors/http";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";
import {
  NEED, type GTool, draftId, emailsIn, folderId, gcall, human, msgId, multipartRelated, oneLine, qs, str, threadId, bytesToText,
} from "@/lib/connectors/google/shared";
import {
  addressList, attachmentsInput, buildMime, describeAttachments, parseAddresses, resolveAttachments, type Attachment, type AttachmentRef, type Mail,
} from "@/lib/connectors/google/mime";

const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

type Header = { name: string; value: string };
export type Part = { partId?: string; mimeType?: string; filename?: string; headers?: Header[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
type Msg = { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

export const header = (m: Record<string, unknown> | Msg, n: string) =>
  ((((m as Msg).payload)?.headers) ?? []).find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";

export function textOf(p: Part | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data && !p.filename) return unb64(p.body.data).toString("utf8");
  for (const c of p.parts ?? []) { const t = textOf(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data && !p.filename) return unb64(p.body.data).toString("utf8").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  return "";
}

/** Every attachment part of a message (including inline files), with its stable part id. */
export function attachmentsOf(p: Part | undefined, out: Part[] = []): Part[] {
  if (!p) return out;
  if (p.filename && (p.body?.attachmentId || p.body?.data)) out.push(p);
  for (const c of p.parts ?? []) attachmentsOf(c, out);
  return out;
}
const attList = (m: Msg) => attachmentsOf(m.payload).map((p) => ({ part_id: p.partId, filename: p.filename, mime_type: p.mimeType, size: human(p.body?.size) }));

const summary = (m: Msg) => ({
  id: m.id, thread_id: m.threadId, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"),
  snippet: m.snippet, unread: (m.labelIds ?? []).includes("UNREAD"), starred: (m.labelIds ?? []).includes("STARRED"), labels: m.labelIds ?? [],
});
const META = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";
const getMsg = (ctx: ToolContext, id: string, format: "full" | "metadata" = "full") =>
  gcall<Msg>(ctx, `${GM}/messages/${id}?${format === "full" ? "format=full" : META}`);

export async function myAddress(ctx: ToolContext): Promise<string> {
  const p = await gcall<{ emailAddress?: string }>(ctx, `${GM}/profile`);
  return str(p.emailAddress).toLowerCase();
}

// ------------------------------------------------------------------ sending

async function sendRaw(ctx: ToolContext, mime: string, threadId?: string): Promise<{ id?: string; threadId?: string }> {
  if (Buffer.byteLength(mime) < 4_500_000) return gcall(ctx, `${GM}/messages/send`, { method: "POST", body: { json: { raw: b64url(mime), ...(threadId ? { threadId } : {}) } } });
  return gcall(ctx, `${UPLOAD}/messages/send?uploadType=multipart`, { method: "POST", body: multipartRelated(threadId ? { threadId } : {}, Buffer.from(mime, "utf8"), "message/rfc822"), timeoutMs: 90000 });
}
async function saveDraft(ctx: ToolContext, mime: string, threadId?: string, draft?: string): Promise<{ id?: string; message?: { id?: string; threadId?: string } }> {
  const method = draft ? "PUT" : "POST";
  const path = draft ? `/drafts/${draft}` : "/drafts";
  const message = threadId ? { threadId } : {};
  if (Buffer.byteLength(mime) < 4_500_000) return gcall(ctx, `${GM}${path}`, { method, body: { json: { ...(draft ? { id: draft } : {}), message: { ...message, raw: b64url(mime) } } } });
  return gcall(ctx, `${UPLOAD}${path}?uploadType=multipart`, { method, body: multipartRelated({ message }, Buffer.from(mime, "utf8"), "message/rfc822"), timeoutMs: 90000 });
}

/**
 * Send one email from the user's Gmail. Only ever reached through the approval gate
 * (gmail_send has requiresApproval: true, and executeToolCall never runs approval tools).
 */
export async function sendMail(token: string, a: { to: string; cc?: string; bcc?: string; subject: string; body: string }, f: typeof fetch = fetch, extra: { attachments?: Attachment[] } = {}): Promise<{ sent: true; message_id?: string; thread_id?: string; to: string[] }> {
  const to = parseAddresses(a.to), cc = parseAddresses(a.cc), bcc = parseAddresses(a.bcc);
  if (!to?.length || !cc || !bcc) throw new Error("Invalid recipients");
  const r = await sendRaw({ token, fetch: f, meta: {} }, buildMime({ to, cc, bcc, subject: a.subject, body: a.body, attachments: extra.attachments }));
  return { sent: true, message_id: r.id, thread_id: r.threadId, to };
}

// ------------------------------------------------------------------ replies and forwards

type ReplyPlan = { mail: Mail; threadId?: string; original: { from: string; subject: string; date: string } };

/** Who a reply (or reply-all) goes to, with threading headers, from the original message. */
export async function planReply(ctx: ToolContext, a: { message_id: string; body: string; cc?: string; all: boolean; quote?: boolean }): Promise<ReplyPlan> {
  const [m, me] = await Promise.all([getMsg(ctx, a.message_id, "full"), myAddress(ctx)]);
  const from = header(m, "From"), replyTo = header(m, "Reply-To");
  const fromMe = emailsIn(from).includes(me);
  let to = fromMe ? emailsIn(header(m, "To")) : emailsIn(replyTo || from);
  let cc: string[] = [];
  if (a.all) {
    const others = [...emailsIn(header(m, "To")), ...emailsIn(header(m, "Cc"))];
    cc = others.filter((e) => e !== me && !to.includes(e));
    if (fromMe) { to = emailsIn(header(m, "To")).filter((e) => e !== me); cc = emailsIn(header(m, "Cc")).filter((e) => e !== me && !to.includes(e)); }
  }
  to = to.filter((e) => e !== me || fromMe);
  for (const e of parseAddresses(a.cc, 20) ?? []) if (!cc.includes(e) && !to.includes(e)) cc.push(e);
  if (!to.length) throw new ConnectorError("Couldn't work out who to reply to from that email.", 400, "invalid");
  const subject0 = header(m, "Subject");
  const subject = /^re:/i.test(subject0.trim()) ? subject0 : `Re: ${subject0}`;
  const msgIdH = header(m, "Message-ID") || header(m, "Message-Id");
  const refs = [header(m, "References"), msgIdH].filter(Boolean).join(" ").trim();
  const quoted = a.quote === false ? "" : `\n\nOn ${header(m, "Date")}, ${from} wrote:\n${clip(textOf(m.payload), 6000).split("\n").map((l) => `> ${l}`).join("\n")}`;
  return {
    mail: { to: to.slice(0, 50), cc: cc.slice(0, 50), subject, body: a.body + quoted, ...(msgIdH ? { inReplyTo: msgIdH, references: refs } : {}) },
    threadId: m.threadId, original: { from, subject: subject0, date: header(m, "Date") },
  };
}

async function planForward(ctx: ToolContext, a: { message_id: string; to: string; cc?: string; note?: string; include_attachments?: boolean }): Promise<{ mail: Mail; parts: Part[]; m: Msg }> {
  const m = await getMsg(ctx, a.message_id, "full");
  const s0 = header(m, "Subject");
  const subject = /^(fwd?|fw):/i.test(s0.trim()) ? s0 : `Fwd: ${s0}`;
  const block = [`---------- Forwarded message ---------`, `From: ${header(m, "From")}`, `Date: ${header(m, "Date")}`, `Subject: ${s0}`, `To: ${header(m, "To")}`, ...(header(m, "Cc") ? [`Cc: ${header(m, "Cc")}`] : [])].join("\n");
  const body = `${a.note ? `${a.note}\n\n` : ""}${block}\n\n${clip(textOf(m.payload), 40000)}`;
  const parts = a.include_attachments === false ? [] : attachmentsOf(m.payload);
  return { mail: { to: parseAddresses(a.to, 20) ?? [], cc: parseAddresses(a.cc, 20) ?? [], subject, body }, parts, m };
}

async function partBytes(ctx: ToolContext, messageId: string, p: Part): Promise<Buffer> {
  if (p.body?.data) return unb64(p.body.data);
  const j = await gcall<{ data?: string }>(ctx, `${GM}/messages/${messageId}/attachments/${encodeURIComponent(str(p.body?.attachmentId))}`);
  return unb64(str(j.data));
}
async function originalAttachments(ctx: ToolContext, messageId: string, parts: Part[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  let total = 0;
  for (const p of parts) {
    const data = await partBytes(ctx, messageId, p);
    total += data.length;
    if (total > 24 * 1024 * 1024) throw new ConnectorError("The original attachments are larger than 24 MB; forward without them (include_attachments: false).", 413, "invalid");
    out.push({ filename: str(p.filename) || "attachment", mimeType: str(p.mimeType) || "application/octet-stream", data });
  }
  return out;
}

const mailPreview = (mail: Mail, extra: Record<string, string> = {}): Record<string, string> => ({
  to: mail.to.join(", "), ...(mail.cc?.length ? { cc: mail.cc.join(", ") } : {}), ...(mail.bcc?.length ? { Bcc: mail.bcc.join(", ") } : {}),
  subject: mail.subject, body: clip(mail.body, 3000), ...extra,
});

// ------------------------------------------------------------------ selecting messages

const ids = z.array(msgId).min(1).max(100);
const targetShape = {
  message_ids: ids.optional().describe("Message ids (from gmail_search)"),
  query: z.string().min(1).max(300).optional().describe("Or a Gmail search; acts on up to `max` matching messages"),
  max: z.number().int().min(1).max(100).default(50),
};
type Target = { message_ids?: string[]; query?: string; max: number };
const target = <T extends z.ZodRawShape>(extra: T) => z.object({ ...targetShape, ...extra }).refine((a) => { const t = a as unknown as Target; return !!t.message_ids?.length !== !!t.query; }, "Give message_ids or query");
async function resolveTarget(ctx: ToolContext, a: Target): Promise<string[]> {
  if (a.message_ids?.length) return a.message_ids;
  const out: string[] = [];
  let page: string | undefined;
  do {
    const j = await gcall<{ messages?: { id: string }[]; nextPageToken?: string }>(ctx, `${GM}/messages${qs({ q: a.query, maxResults: Math.min(100, a.max - out.length), pageToken: page })}`);
    out.push(...(j.messages ?? []).map((m) => m.id));
    page = j.nextPageToken;
  } while (page && out.length < a.max);
  return out.slice(0, a.max);
}
async function batchModify(ctx: ToolContext, list: string[], add: string[], remove: string[]) {
  if (!list.length) return { changed: 0 };
  await gcall(ctx, `${GM}/messages/batchModify`, { method: "POST", body: { json: { ids: list, ...(add.length ? { addLabelIds: add } : {}), ...(remove.length ? { removeLabelIds: remove } : {}) } } });
  return { changed: list.length };
}

type Label = { id: string; name: string; type?: string; messagesTotal?: number; messagesUnread?: number };
const SYSTEM = new Set(["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SPAM", "SENT", "DRAFT", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);
/** Label names (or ids) → ids. Unknown user labels are created when `create` is set. */
async function labelIds(ctx: ToolContext, names: string[], create: boolean): Promise<string[]> {
  if (!names.length) return [];
  const { labels = [] } = await gcall<{ labels?: Label[] }>(ctx, `${GM}/labels`);
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    const up = n.toUpperCase().replace(/\s+/g, "_");
    if (up === "TRASH") throw new ConnectorError("Use gmail_trash to move mail to the trash.", 400, "invalid");
    if (SYSTEM.has(up)) { out.push(up); continue; }
    const hit = labels.find((l) => l.id === n || l.name.toLowerCase() === n.toLowerCase());
    if (hit) { out.push(hit.id); continue; }
    if (!create) throw new ConnectorError(`There's no Gmail label called “${n}”.`, 404, "not_found");
    const made = await gcall<Label>(ctx, `${GM}/labels`, { method: "POST", body: { json: { name: n, labelListVisibility: "labelShow", messageListVisibility: "show" } } });
    labels.push(made);
    out.push(made.id);
  }
  return out;
}

async function subjectsOf(ctx: ToolContext, list: string[], n = 10): Promise<string> {
  const ms = await Promise.all(list.slice(0, n).map((id) => getMsg(ctx, id, "metadata").catch(() => null)));
  const lines = ms.map((m) => (m ? `• ${header(m, "Subject") || "(no subject)"} — ${header(m, "From")}` : "• (couldn't read)"));
  return lines.join("\n") + (list.length > n ? `\n…and ${list.length - n} more` : "");
}

const findPart = (m: Msg, a: { part_id?: string; filename?: string }) => {
  const parts = attachmentsOf(m.payload);
  const p = a.part_id ? parts.find((x) => x.partId === a.part_id) : parts.find((x) => str(x.filename).toLowerCase() === str(a.filename).toLowerCase()) ?? (a.filename ? undefined : parts[0]);
  if (!p) throw new ConnectorError(parts.length ? `No attachment ${a.part_id ? `with part_id ${a.part_id}` : `named “${a.filename}”`}. It has: ${parts.map((x) => `${x.partId} ${x.filename}`).join(", ")}` : "That email has no attachments.", 404, "not_found");
  return p;
};

// ------------------------------------------------------------------ tools

export const GMAIL_TOOLS: GTool[] = [
  { need: NEED.gmailRead, ...tool({
    name: "gmail_search",
    description: "Search Gmail with Gmail search syntax (e.g. from:alice newer_than:7d, is:unread, has:attachment, label:work, in:sent). Returns id, thread id, sender, subject, date, snippet, unread/starred and labels.",
    input: z.object({ query: z.string().min(1).max(300), max: z.number().int().min(1).max(25).default(10) }),
    async execute(a, ctx) {
      const list = await gcall<{ messages?: { id: string }[] }>(ctx, `${GM}/messages${qs({ maxResults: a.max, q: a.query })}`);
      const ms = await Promise.all((list.messages ?? []).map((m) => getMsg(ctx, m.id, "metadata")));
      return ms.map(summary);
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_read",
    description: "Read one email: headers, labels, plain-text body and its attachments (part_id, name, type, size). Use gmail_read_attachment to read an attachment.",
    input: z.object({ message_id: msgId }),
    async execute(a, ctx) {
      const m = await getMsg(ctx, a.message_id, "full");
      return { id: a.message_id, thread_id: m.threadId, from: header(m, "From"), to: header(m, "To"), cc: header(m, "Cc") || undefined, subject: header(m, "Subject"), date: header(m, "Date"), labels: m.labelIds ?? [], body: clip(textOf(m.payload), 15000), attachments: attList(m) };
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_list_threads",
    description: "List email conversations (threads), newest first, optionally filtered by a Gmail search. Returns thread id, subject, participants, message count and snippet.",
    input: z.object({ query: z.string().max(300).optional(), max: z.number().int().min(1).max(25).default(10) }),
    async execute(a, ctx) {
      const list = await gcall<{ threads?: { id: string }[] }>(ctx, `${GM}/threads${qs({ maxResults: a.max, q: a.query })}`);
      const ts = await Promise.all((list.threads ?? []).map((t) => gcall<{ id: string; messages?: Msg[] }>(ctx, `${GM}/threads/${t.id}?${META}`)));
      return ts.map((t) => {
        const ms = t.messages ?? [], first = ms[0] ?? {}, last = ms[ms.length - 1] ?? {};
        return { thread_id: t.id, subject: header(first, "Subject"), from: Array.from(new Set(ms.map((m) => header(m, "From")))).slice(0, 5), messages: ms.length, last_date: header(last, "Date"), snippet: last.snippet, unread: ms.some((m) => (m.labelIds ?? []).includes("UNREAD")) };
      });
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_read_thread",
    description: "Read a whole email conversation: every message's sender, date, text and attachments.",
    input: z.object({ thread_id: threadId }),
    async execute(a, ctx) {
      const t = await gcall<{ messages?: Msg[] }>(ctx, `${GM}/threads/${a.thread_id}?format=full`);
      const ms = t.messages ?? [];
      const per = Math.max(1500, Math.floor(24000 / Math.max(1, ms.length)));
      return { thread_id: a.thread_id, subject: header(ms[0] ?? {}, "Subject"), messages: ms.map((m) => ({ id: m.id, from: header(m, "From"), to: header(m, "To"), date: header(m, "Date"), body: clip(textOf(m.payload), per), attachments: attList(m) })) };
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_read_attachment",
    description: "Read the text of an email attachment (PDF, text, CSV, HTML, JSON). Give the message id and the attachment's part_id or filename from gmail_read. Images and Office files return details only (save them to Drive with gmail_save_attachment_to_drive).",
    input: z.object({ message_id: msgId, part_id: z.string().regex(/^[0-9.]{1,20}$/).optional(), filename: z.string().max(200).optional() }),
    async execute(a, ctx) {
      const m = await getMsg(ctx, a.message_id, "full");
      const p = findPart(m, a);
      const data = await partBytes(ctx, a.message_id, p);
      const text = await bytesToText(data, str(p.mimeType), str(p.filename));
      return { filename: p.filename, mime_type: p.mimeType, size: human(data.length), ...(text ? { content: clip(text, 30000) } : { note: "No readable text in this file type. Save it to Drive (gmail_save_attachment_to_drive) to open it there." }) };
    },
  }) },
  { need: [...NEED.gmailRead, ...NEED.driveCreate], ...tool({
    name: "gmail_save_attachment_to_drive",
    description: "Save an email attachment into Google Drive (optionally into a folder). Returns the Drive file and link.",
    input: z.object({ message_id: msgId, part_id: z.string().regex(/^[0-9.]{1,20}$/).optional(), filename: z.string().max(200).optional(), folder_id: folderId.optional() }),
    async execute(a, ctx) {
      const m = await getMsg(ctx, a.message_id, "full");
      const p = findPart(m, a);
      const data = await partBytes(ctx, a.message_id, p);
      const meta = { name: str(p.filename) || "attachment", ...(a.folder_id ? { parents: [a.folder_id] } : {}) };
      const f = await gcall<Record<string, unknown>>(ctx, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true", { method: "POST", body: multipartRelated(meta, data, str(p.mimeType) || "application/octet-stream"), timeoutMs: 90000 });
      return { saved: true, file: f };
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_find_verification",
    description: "Find the newest sign-up/login verification email (OTP code or confirm link) from a website, for example after the user registered on it with their Gmail. Returns only the code or link, never the full email.",
    input: z.object({ site: z.string().min(2).max(100).describe("Website or sender domain, e.g. github.com"), minutes: z.number().int().min(1).max(1440).default(30) }),
    async execute(a, ctx) {
      const { siteDomain, extractVerification } = await import("@/lib/connectors/google/verify");
      const domain = siteDomain(a.site);
      if (!domain) return { found: false, note: "Give a website domain like example.com." };
      const q = `from:${domain} newer_than:${Math.max(1, Math.ceil(a.minutes / 60))}h`;
      const list = await gcall<{ messages?: { id: string }[] }>(ctx, `${GM}/messages${qs({ maxResults: 5, q })}`);
      for (const m of list.messages ?? []) {
        const full = await getMsg(ctx, m.id, "full");
        const sentAt = Number(full.internalDate ?? 0);
        if (sentAt && Date.now() - sentAt > a.minutes * 60000) continue;
        const v = extractVerification(header(full, "Subject") + "\n" + textOf(full.payload), domain);
        if (v.code || v.link) return { found: true, from: header(full, "From"), subject: header(full, "Subject"), received: header(full, "Date"), ...v };
      }
      return { found: false, note: `No verification email from ${domain} in the last ${a.minutes} minutes.` };
    },
  }) },
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_create_draft",
    description: "Create a Gmail draft (it is NOT sent; no approval needed). Can attach files from Drive or a link, and can be a reply in an existing conversation (reply_to_message_id; recipients default to the reply's).",
    input: z.object({
      to: addressList(20).optional(), cc: addressList(20).optional(), bcc: addressList(20).optional(),
      subject: z.string().max(300).default(""), body: z.string().max(50000), attachments: attachmentsInput,
      reply_to_message_id: msgId.optional().describe("Make the draft a reply in this email's conversation"), reply_all: z.boolean().default(false),
    }),
    async execute(a, ctx) {
      let mail: Mail, thread: string | undefined;
      if (a.reply_to_message_id) {
        const plan = await planReply(ctx, { message_id: a.reply_to_message_id, body: a.body, cc: a.cc, all: a.reply_all });
        mail = { ...plan.mail, ...(a.to ? { to: parseAddresses(a.to, 20) ?? [] } : {}), ...(a.subject ? { subject: a.subject } : {}), bcc: parseAddresses(a.bcc, 20) ?? [] };
        thread = plan.threadId;
      } else mail = { to: parseAddresses(a.to, 20) ?? [], cc: parseAddresses(a.cc, 20) ?? [], bcc: parseAddresses(a.bcc, 20) ?? [], subject: a.subject, body: a.body };
      mail.attachments = await resolveAttachments(ctx, a.attachments);
      const d = await saveDraft(ctx, buildMime(mail), thread);
      return { draft_id: d.id, to: mail.to, subject: mail.subject, attachments: mail.attachments.map((x) => x.filename), note: "Draft saved in Gmail. It has not been sent." };
    },
  }) },
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_send",
    description:
      "Send an email from the user's Gmail, optionally with attachments from Google Drive (drive_file_id) or a link (url). ALWAYS needs the user's approval: calling it only shows them an approval card with the full email, and nothing is sent until they tap Approve. " +
      "Use it only after the user clearly asked to send (bhej do / send it) and gave or confirmed the recipient's address; never guess an address (use contacts_search to look one up). Pass the final subject and body exactly as shown to the user.",
    input: z.object({
      to: addressList(10).describe("Recipient email address(es), comma separated"),
      cc: addressList(10).optional().describe("Optional CC addresses, comma separated"),
      bcc: addressList(10).optional().describe("Optional BCC addresses, comma separated"),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(20000),
      attachments: attachmentsInput,
    }),
    requiresApproval: true,
    summarize: (a) => `Send the email “${oneLine(a.subject).slice(0, 120)}” to ${(parseAddresses(a.to) ?? []).join(", ").slice(0, 150)}${a.attachments?.length ? ` with ${a.attachments.length} attachment${a.attachments.length > 1 ? "s" : ""}` : ""}`,
    async prepare(a, ctx): Promise<ToolPreview> {
      if (!a.attachments?.length && !a.bcc) return {};
      return { details: { ...(a.bcc ? { Bcc: (parseAddresses(a.bcc) ?? []).join(", ") } : {}), ...(a.attachments?.length ? { Attachments: await describeAttachments(ctx, a.attachments as AttachmentRef[]) } : {}) } };
    },
    async execute(a, ctx) {
      const attachments = await resolveAttachments(ctx, a.attachments);
      const r = await sendMail(ctx.token, a, ctx.fetch, { attachments });
      return { ...r, attachments: attachments.map((x) => x.filename), note: "Sent from the user's Gmail." };
    },
  }) },
  ...(["gmail_reply", "gmail_reply_all"] as const).map((name): GTool => ({ need: NEED.gmailCompose, ...tool({
    name,
    description: name === "gmail_reply"
      ? "Reply to an email in its conversation (to the sender, or to Reply-To). Needs the user's approval: shows a card with the recipients and text; nothing is sent until they tap Approve. Can attach files from Drive or a link."
      : "Reply to everyone on an email (sender + all To/Cc except the user) in its conversation. Needs the user's approval: shows a card with every recipient and the text; nothing is sent until they tap Approve.",
    input: z.object({
      message_id: msgId.describe("The email being replied to (from gmail_search / gmail_read)"),
      body: z.string().min(1).max(20000).describe("Only the new reply text; the original is quoted below it automatically"),
      cc: addressList(10).optional().describe("Extra CC addresses"),
      attachments: attachmentsInput,
      quote_original: z.boolean().default(true),
    }),
    requiresApproval: true,
    summarize: () => (name === "gmail_reply" ? "Reply to an email" : "Reply to everyone on an email"),
    async prepare(a, ctx): Promise<ToolPreview> {
      const plan = await planReply(ctx, { message_id: a.message_id, body: a.body, cc: a.cc, all: name === "gmail_reply_all", quote: a.quote_original });
      const att: Record<string, string> = a.attachments?.length ? { Attachments: await describeAttachments(ctx, a.attachments as AttachmentRef[]) } : {};
      return {
        summary: `${name === "gmail_reply" ? "Reply" : "Reply all"} to “${oneLine(plan.original.subject).slice(0, 100)}” → ${[...plan.mail.to, ...(plan.mail.cc ?? [])].join(", ").slice(0, 150)}`,
        details: mailPreview({ ...plan.mail, body: a.body }, { "In reply to": `${plan.original.from} · ${plan.original.date}`.slice(0, 300), ...att }),
      };
    },
    async execute(a, ctx) {
      const plan = await planReply(ctx, { message_id: a.message_id, body: a.body, cc: a.cc, all: name === "gmail_reply_all", quote: a.quote_original });
      plan.mail.attachments = await resolveAttachments(ctx, a.attachments);
      const r = await sendRaw(ctx, buildMime(plan.mail), plan.threadId);
      return { sent: true, message_id: r.id, thread_id: r.threadId, to: plan.mail.to, cc: plan.mail.cc, note: "Reply sent from the user's Gmail." };
    },
  }) })),
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_forward",
    description: "Forward an email (with its attachments by default) to someone, with an optional note on top. Needs the user's approval: shows a card with the recipients and text; nothing is sent until they tap Approve.",
    input: z.object({
      message_id: msgId, to: addressList(10), cc: addressList(10).optional(),
      note: z.string().max(10000).optional().describe("Text added above the forwarded email"),
      include_attachments: z.boolean().default(true),
    }),
    requiresApproval: true,
    summarize: (a) => `Forward an email to ${(parseAddresses(a.to) ?? []).join(", ").slice(0, 150)}`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const { mail, parts } = await planForward(ctx, a);
      return {
        summary: `Forward “${oneLine(mail.subject.replace(/^fwd:\s*/i, "")).slice(0, 100)}” to ${mail.to.join(", ").slice(0, 150)}`,
        details: mailPreview(mail, parts.length ? { Attachments: parts.map((p) => `${p.filename} (${human(p.body?.size)})`).join("\n") } : {}),
      };
    },
    async execute(a, ctx) {
      const { mail, parts } = await planForward(ctx, a);
      mail.attachments = await originalAttachments(ctx, a.message_id, parts);
      const r = await sendRaw(ctx, buildMime(mail));
      return { sent: true, message_id: r.id, to: mail.to, attachments: mail.attachments.map((x) => x.filename), note: "Forwarded from the user's Gmail." };
    },
  }) },
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_list_drafts",
    description: "List Gmail drafts (id, recipients, subject, snippet).",
    input: z.object({ max: z.number().int().min(1).max(25).default(10) }),
    async execute(a, ctx) {
      const j = await gcall<{ drafts?: { id: string; message?: { id: string } }[] }>(ctx, `${GM}/drafts${qs({ maxResults: a.max })}`);
      const ds = await Promise.all((j.drafts ?? []).map((d) => gcall<{ id: string; message?: Msg }>(ctx, `${GM}/drafts/${d.id}?format=metadata`)));
      return ds.map((d) => ({ draft_id: d.id, to: header(d.message ?? {}, "To"), subject: header(d.message ?? {}, "Subject"), snippet: d.message?.snippet }));
    },
  }) },
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_send_draft",
    description: "Send an existing Gmail draft as it is. Needs the user's approval (card shows its recipients, subject and text).",
    input: z.object({ draft_id: draftId }),
    requiresApproval: true,
    summarize: () => "Send a Gmail draft",
    async prepare(a, ctx): Promise<ToolPreview> {
      const d = await gcall<{ message?: Msg }>(ctx, `${GM}/drafts/${a.draft_id}?format=full`);
      const m = d.message ?? {};
      if (!header(m, "To") && !header(m, "Cc") && !header(m, "Bcc")) throw new ConnectorError("That draft has no recipients yet.", 400, "invalid");
      const att = attachmentsOf(m.payload);
      return { summary: `Send the draft “${oneLine(header(m, "Subject")).slice(0, 100)}” to ${header(m, "To").slice(0, 150)}`, details: { to: header(m, "To"), ...(header(m, "Cc") ? { cc: header(m, "Cc") } : {}), subject: header(m, "Subject"), body: clip(textOf(m.payload), 3000), ...(att.length ? { Attachments: att.map((p) => p.filename).join("\n") } : {}) } };
    },
    async execute(a, ctx) {
      const r = await gcall<{ id?: string; threadId?: string }>(ctx, `${GM}/drafts/send`, { method: "POST", body: { json: { id: a.draft_id } } });
      return { sent: true, message_id: r.id, thread_id: r.threadId };
    },
  }) },
  { need: NEED.gmailCompose, ...tool({
    name: "gmail_delete_draft",
    description: "Delete a Gmail draft permanently. Needs the user's approval (card shows the draft).",
    input: z.object({ draft_id: draftId }),
    requiresApproval: true,
    summarize: () => "Delete a Gmail draft",
    async prepare(a, ctx): Promise<ToolPreview> {
      const d = await gcall<{ message?: Msg }>(ctx, `${GM}/drafts/${a.draft_id}?format=metadata`);
      const m = d.message ?? {};
      return { summary: `Delete the draft “${oneLine(header(m, "Subject") || "(no subject)").slice(0, 120)}”`, details: { to: header(m, "To"), subject: header(m, "Subject"), body: str(m.snippet) }, warning: "Deleted drafts can't be recovered." };
    },
    async execute(a, ctx) {
      await gcall(ctx, `${GM}/drafts/${a.draft_id}`, { method: "DELETE" });
      return { deleted: true, draft_id: a.draft_id };
    },
  }) },
  { need: NEED.gmailRead, ...tool({
    name: "gmail_list_labels",
    description: "List Gmail labels (system and the user's own), with message and unread counts.",
    input: z.object({ with_counts: z.boolean().default(false).describe("Also fetch total/unread counts (slower)") }),
    async execute(a, ctx) {
      const { labels = [] } = await gcall<{ labels?: Label[] }>(ctx, `${GM}/labels`);
      const list = a.with_counts ? await Promise.all(labels.slice(0, 60).map((l) => gcall<Label>(ctx, `${GM}/labels/${encodeURIComponent(l.id)}`).catch(() => l))) : labels;
      return list.map((l) => ({ id: l.id, name: l.name, type: l.type, ...(a.with_counts ? { total: l.messagesTotal, unread: l.messagesUnread } : {}) }));
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_create_label",
    description: "Create a Gmail label (use slashes for nesting, e.g. Work/Invoices).",
    input: z.object({ name: z.string().min(1).max(200) }),
    async execute(a, ctx) {
      const l = await gcall<Label>(ctx, `${GM}/labels`, { method: "POST", body: { json: { name: oneLine(a.name), labelListVisibility: "labelShow", messageListVisibility: "show" } } });
      return { created: true, id: l.id, name: l.name };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_delete_label",
    description: "Delete one of the user's Gmail labels (the emails stay; only the label is removed). Needs the user's approval.",
    input: z.object({ label: z.string().min(1).max(200).describe("Label name or id") }),
    requiresApproval: true,
    summarize: (a) => `Delete the Gmail label “${oneLine(a.label).slice(0, 100)}”`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const [id] = await labelIds(ctx, [a.label], false);
      if (SYSTEM.has(id)) throw new ConnectorError("System labels can't be deleted.", 400, "invalid");
      const l = await gcall<Label>(ctx, `${GM}/labels/${encodeURIComponent(id)}`);
      return { details: { Label: l.name, Emails: `${l.messagesTotal ?? 0} (they stay in Gmail)` } };
    },
    async execute(a, ctx) {
      const [id] = await labelIds(ctx, [a.label], false);
      if (SYSTEM.has(id)) throw new ConnectorError("System labels can't be deleted.", 400, "invalid");
      await gcall(ctx, `${GM}/labels/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { deleted: true, label: a.label };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_modify_labels",
    description: "Add or remove labels on emails (by message_ids or a Gmail search). Label names or ids; INBOX, UNREAD, STARRED, IMPORTANT, SPAM work too. Missing user labels are created.",
    input: target({ add: z.array(z.string().min(1).max(200)).max(10).default([]), remove: z.array(z.string().min(1).max(200)).max(10).default([]) }).refine((a) => a.add.length + a.remove.length > 0, "Give labels to add or remove"),
    async execute(a, ctx) {
      const [add, remove, list] = await Promise.all([labelIds(ctx, a.add, true), labelIds(ctx, a.remove, false), resolveTarget(ctx, a as Target)]);
      return { ...(await batchModify(ctx, list, add, remove)), added: a.add, removed: a.remove };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_archive",
    description: "Archive emails (remove them from the Inbox; they stay in All Mail). unarchive: true moves them back to the Inbox.",
    input: target({ unarchive: z.boolean().default(false) }),
    async execute(a, ctx) {
      const list = await resolveTarget(ctx, a);
      return { ...(await batchModify(ctx, list, a.unarchive ? ["INBOX"] : [], a.unarchive ? [] : ["INBOX"])), action: a.unarchive ? "moved to Inbox" : "archived" };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_mark_read",
    description: "Mark emails as read (or unread: true to mark them unread), by message_ids or a Gmail search.",
    input: target({ unread: z.boolean().default(false) }),
    async execute(a, ctx) {
      const list = await resolveTarget(ctx, a);
      return { ...(await batchModify(ctx, list, a.unread ? ["UNREAD"] : [], a.unread ? [] : ["UNREAD"])), action: a.unread ? "marked unread" : "marked read" };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_star",
    description: "Star emails (or unstar: true to remove the star), by message_ids or a Gmail search.",
    input: target({ unstar: z.boolean().default(false) }),
    async execute(a, ctx) {
      const list = await resolveTarget(ctx, a);
      return { ...(await batchModify(ctx, list, a.unstar ? [] : ["STARRED"], a.unstar ? ["STARRED"] : [])), action: a.unstar ? "unstarred" : "starred" };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_trash",
    description: "Move emails to the Trash (recoverable for 30 days). Give message_ids (search first with gmail_search). Always needs the user's approval on a card listing them, even for one email.",
    input: z.object({ message_ids: ids }),
    requiresApproval: true,
    summarize: (a) => a.message_ids.length === 1 ? "Move 1 email to the Trash" : `Move ${a.message_ids.length} emails to the Trash`,
    async prepare(a, ctx): Promise<ToolPreview> {
      return { details: { Emails: await subjectsOf(ctx, a.message_ids), Count: String(a.message_ids.length) }, warning: "They stay in Gmail's Trash for 30 days, then Gmail deletes them for good." };
    },
    async execute(a, ctx) {
      for (const id of a.message_ids) await gcall(ctx, `${GM}/messages/${id}/trash`, { method: "POST" });
      return { trashed: a.message_ids.length, note: "Moved to Trash; recoverable for 30 days (gmail_untrash)." };
    },
  }) },
  { need: NEED.gmailModify, ...tool({
    name: "gmail_untrash",
    description: "Restore emails from the Trash.",
    input: z.object({ message_ids: ids }),
    async execute(a, ctx) {
      for (const id of a.message_ids) await gcall(ctx, `${GM}/messages/${id}/untrash`, { method: "POST" });
      return { restored: a.message_ids.length };
    },
  }) },
];

