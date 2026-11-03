import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ConnectionInfo, ToolContext, ToolDef } from "@/lib/connectors/types";

/**
 * Google (Gmail, Calendar, Drive) via the official REST APIs and the OAuth 2.0 web-server flow.
 * Replaces the earlier google_calendar integration; migration 0007 moves those rows to connector "google".
 * Tools are only offered for scopes the user actually granted (older Calendar-only connections keep
 * working for Calendar and simply don't see Gmail/Drive until reconnected).
 */
export const SCOPES = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
};

const auth = (ctx: ToolContext) => ({ Authorization: `Bearer ${ctx.token}` });
const get = <T = unknown>(ctx: ToolContext, url: string) => apiFetch<T>(url, { f: ctx.fetch, headers: auth(ctx) });
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const header = (m: Record<string, unknown>, n: string) =>
  (((m.payload as Record<string, unknown>)?.headers as { name: string; value: string }[]) ?? []).find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
function textOf(p: Part | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return unb64(p.body.data);
  for (const c of p.parts ?? []) { const t = textOf(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return unb64(p.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}
/** "https://www.Example.com/x" -> "example.com"; null for anything that isn't a plain domain. */
export function siteDomain(site: string): string | null {
  let h = site.trim().toLowerCase();
  try { if (/^https?:\/\//.test(h)) h = new URL(h).hostname; } catch { return null; }
  h = h.replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
}

/** Pull an OTP code and/or a verification link (on the sender's own domain) out of an email. */
export function extractVerification(text: string, domain: string): { code?: string; link?: string } {
  const out: { code?: string; link?: string } = {};
  const kw = /(?:code|otp|pin|passcode|verification|verify|one[- ]time|confirm)(?:\W+(?:is|code|:|=|your|the)){0,3}\W{0,10}(\d{3}[- ]\d{3}|(?=[A-Z0-9]*\d)[A-Z0-9]{4,8})\b/i;
  const near = text.match(kw) ?? text.match(/\b(\d{6})\b/);
  if (near) out.code = near[1].replace(/[- ]/g, "");
  const links = text.match(/https:\/\/[^\s"'<>)]+/g) ?? [];
  const link = links.find((l) => {
    try {
      const h = new URL(l).hostname.toLowerCase();
      return (h === domain || h.endsWith("." + domain)) && /verif|confirm|activate|magic|token|login|auth/i.test(l);
    } catch { return false; }
  });
  if (link) out.link = link.slice(0, 1000);
  return out;
}

/** Header injection guard for drafted mail. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
/** RFC 2047 encoded-word for non-ASCII header text (Hindi subjects, names). */
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Comma/semicolon separated addresses -> a clean, de-duplicated list (null when any entry is not an email). */
export function parseAddresses(raw: string | undefined, max = 10): string[] | null {
  if (!raw || !raw.trim()) return [];
  const list = raw.split(/[,;]/).map((x) => oneLine(x)).filter(Boolean);
  const email = z.string().email();
  if (list.length > max || list.some((x) => !email.safeParse(x).success)) return null;
  return Array.from(new Set(list.map((x) => x.toLowerCase())));
}

const addressList = (max: number) => z.string().max(2000).refine((v) => { const l = parseAddresses(v, max); return !!l; }, { message: `Up to ${max} valid email addresses, separated by commas` });

/** The raw RFC 5322 message, UTF-8 safe (base64 body), with header injection stripped. */
export function buildMime(a: { to: string[]; cc?: string[]; subject: string; body: string }): string {
  const lines = [
    `To: ${a.to.join(", ")}`,
    ...(a.cc?.length ? [`Cc: ${a.cc.join(", ")}`] : []),
    `Subject: ${encHeader(oneLine(a.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(a.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${lines.join("\r\n")}\r\n\r\n${body}`;
}

/**
 * Send one email from the user's Gmail. Only ever reached through the approval gate
 * (gmail_send has requiresApproval: true, and executeToolCall never runs approval tools).
 */
export async function sendMail(token: string, a: { to: string; cc?: string; subject: string; body: string }, f: typeof fetch = fetch): Promise<{ sent: true; message_id?: string; thread_id?: string; to: string[] }> {
  const to = parseAddresses(a.to), cc = parseAddresses(a.cc);
  if (!to?.length || !cc) throw new Error("Invalid recipients");
  const raw = b64url(buildMime({ to, cc, subject: a.subject, body: a.body }));
  const r = await apiFetch<{ id?: string; threadId?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", f, headers: { Authorization: `Bearer ${token}` }, body: { raw } });
  return { sent: true, message_id: r.id, thread_id: r.threadId, to };
}

const ALL_TOOLS: (ToolDef & { scope: string })[] = [
  { scope: SCOPES.gmailRead, ...tool({
    name: "gmail_search",
    description: "Search Gmail with Gmail search syntax (e.g. from:alice newer_than:7d). Returns sender, subject, date and snippet.",
    input: z.object({ query: z.string().min(1).max(300), max: z.number().int().min(1).max(20).default(10) }),
    async execute(a, ctx) {
      const list = await get<{ messages?: { id: string }[] }>(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${a.max}&q=${encodeURIComponent(a.query)}`);
      const out = [];
      for (const m of list.messages ?? []) {
        const full = await get<Record<string, unknown>>(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        out.push({ id: m.id, from: header(full, "From"), subject: header(full, "Subject"), date: header(full, "Date"), snippet: full.snippet });
      }
      return out;
    },
  }) },
  { scope: SCOPES.gmailRead, ...tool({
    name: "gmail_read",
    description: "Read one email (headers and plain-text body).",
    input: z.object({ message_id: z.string().regex(/^[A-Za-z0-9]{6,64}$/) }),
    async execute(a, ctx) {
      const m = await get<Record<string, unknown>>(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${a.message_id}?format=full`);
      return { id: a.message_id, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), body: clip(textOf(m.payload as Part), 15000) };
    },
  }) },
  { scope: SCOPES.gmailRead, ...tool({
    name: "gmail_find_verification",
    description: "Find the newest sign-up/login verification email (OTP code or confirm link) from a website, for example after the user registered on it with their Gmail. Returns only the code or link, never the full email.",
    input: z.object({ site: z.string().min(2).max(100).describe("Website or sender domain, e.g. github.com"), minutes: z.number().int().min(1).max(1440).default(30) }),
    async execute(a, ctx) {
      const domain = siteDomain(a.site);
      if (!domain) return { found: false, note: "Give a website domain like example.com." };
      const q = `from:${domain} newer_than:${Math.max(1, Math.ceil(a.minutes / 60))}h`;
      const list = await get<{ messages?: { id: string }[] }>(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(q)}`);
      for (const m of list.messages ?? []) {
        const full = await get<Record<string, unknown>>(ctx, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`);
        const sentAt = Number(full.internalDate ?? 0);
        if (sentAt && Date.now() - sentAt > a.minutes * 60000) continue;
        const v = extractVerification(header(full, "Subject") + "\n" + textOf(full.payload as Part), domain);
        if (v.code || v.link) return { found: true, from: header(full, "From"), subject: header(full, "Subject"), received: header(full, "Date"), ...v };
      }
      return { found: false, note: `No verification email from ${domain} in the last ${a.minutes} minutes.` };
    },
  }) },
  { scope: SCOPES.gmailCompose, ...tool({
    name: "gmail_create_draft",
    description: "Create a Gmail draft (it is NOT sent; the user sends it from Gmail).",
    input: z.object({ to: z.string().email(), subject: z.string().max(300), body: z.string().max(50000) }),
    async execute(a, ctx) {
      const raw = b64url(buildMime({ to: [oneLine(a.to)], subject: a.subject, body: a.body }));
      const d = await apiFetch<{ id?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", f: ctx.fetch, headers: auth(ctx), body: { message: { raw } } });
      return { draft_id: d.id, note: "Draft saved in Gmail. It has not been sent." };
    },
  }) },
  { scope: SCOPES.gmailCompose, ...tool({
    name: "gmail_send",
    description:
      "Send an email from the user's Gmail. ALWAYS needs the user's approval: calling it only shows them an approval card with the full email, and nothing is sent until they tap Approve. " +
      "Use it only after the user clearly asked to send (bhej do / send it) and gave or confirmed the recipient's address; never guess an address. Pass the final subject and body exactly as shown to the user.",
    input: z.object({
      to: addressList(10).describe("Recipient email address(es), comma separated"),
      cc: addressList(10).optional().describe("Optional CC addresses, comma separated"),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(20000),
    }),
    requiresApproval: true,
    summarize: (a) => `Send the email “${oneLine(a.subject).slice(0, 120)}” to ${(parseAddresses(a.to) ?? []).join(", ").slice(0, 150)}`,
    async execute(a, ctx) {
      const r = await sendMail(ctx.token, a, ctx.fetch);
      return { ...r, note: "Sent from the user's Gmail." };
    },
  }) },
  { scope: SCOPES.calendar, ...tool({
    name: "calendar_list_events",
    description: "List upcoming events on the primary calendar.",
    input: z.object({ time_min: z.string().datetime({ offset: true }).optional(), time_max: z.string().datetime({ offset: true }).optional(), max: z.number().int().min(1).max(50).default(10) }),
    async execute(a, ctx) {
      const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(a.max), timeMin: a.time_min ?? new Date().toISOString(), ...(a.time_max ? { timeMax: a.time_max } : {}) });
      const j = await get<{ items?: Record<string, unknown>[] }>(ctx, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
      return (j.items ?? []).map((e) => ({ id: e.id, title: e.summary, start: e.start, end: e.end, location: e.location }));
    },
  }) },
  { scope: SCOPES.calendar, ...tool({
    name: "calendar_create_event",
    description: "Create an event on the primary calendar (requires the user's approval).",
    input: z.object({ title: z.string().min(1).max(200), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), location: z.string().max(200).optional(), details: z.string().max(2000).optional() }),
    requiresApproval: true,
    summarize: (a) => `Add “${a.title}” to your Google Calendar`,
    async execute(a, ctx) {
      return createEvent(ctx.token, a, ctx.fetch);
    },
  }) },
  { scope: SCOPES.driveRead, ...tool({
    name: "drive_search",
    description: "Search Google Drive files by text.",
    input: z.object({ query: z.string().min(1).max(200), max: z.number().int().min(1).max(25).default(10) }),
    async execute(a, ctx) {
      const q = `fullText contains '${a.query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
      const j = await get<{ files?: Record<string, unknown>[] }>(ctx, `https://www.googleapis.com/drive/v3/files?pageSize=${a.max}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(q)}`);
      return j.files ?? [];
    },
  }) },
  { scope: SCOPES.driveRead, ...tool({
    name: "drive_read",
    description: "Read the text of a Drive file (Google Docs/Sheets/Slides are exported as text; other text files are downloaded).",
    input: z.object({ file_id: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/) }),
    async execute(a, ctx) {
      const meta = await get<{ name?: string; mimeType?: string }>(ctx, `https://www.googleapis.com/drive/v3/files/${a.file_id}?fields=name,mimeType`);
      const mt = meta.mimeType ?? "";
      const exportAs: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
      let url = "";
      if (exportAs[mt]) url = `https://www.googleapis.com/drive/v3/files/${a.file_id}/export?mimeType=${encodeURIComponent(exportAs[mt])}`;
      else if (mt.startsWith("text/") || mt === "application/json") url = `https://www.googleapis.com/drive/v3/files/${a.file_id}?alt=media`;
      if (!url) return { name: meta.name, mimeType: mt, note: "Binary file; only metadata is available." };
      const text = await apiFetch<string>(url, { f: ctx.fetch, headers: auth(ctx), raw: true });
      return { name: meta.name, mimeType: mt, content: clip(String(text), 20000) };
    },
  }) },
];

export async function createEvent(token: string, p: { title: string; start: string; end: string; location?: string; details?: string }, f: typeof fetch = fetch) {
  const j = await apiFetch<{ id?: string; htmlLink?: string }>("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST", f, headers: { Authorization: `Bearer ${token}` },
    body: { summary: p.title, location: p.location || undefined, description: p.details || undefined, start: { dateTime: p.start }, end: { dateTime: p.end } },
  });
  return { eventId: j.id ?? "", link: j.htmlLink ?? "" };
}

export const google = defineConnector({
  id: "google",
  name: "Google",
  icon: "G",
  description: "Search and read Gmail, write drafts, send email after you approve it, see and add Calendar events, and search and read Drive files.",
  auth: "oauth",
  scopes: ["openid", "email", SCOPES.gmailRead, SCOPES.gmailCompose, SCOPES.calendar, SCOPES.driveRead],
  capabilities: [
    "Search and read your email; create drafts; send an email only after you approve that exact email",
    "List calendar events; add events (asks you first)",
    "Search Drive and read documents",
  ],
  permissions: [
    "gmail.readonly: read your email. gmail.compose: create drafts and send email. Every email waits for your approval, showing the recipients, subject and text, before it is sent.",
    "calendar.events: view and edit events on your calendars. New events wait for your approval.",
    "drive.readonly: view (not change) your Drive files.",
    "You can untick permissions on Google's consent screen; TARGET only offers tools for what you grant. Revoke any time at myaccount.google.com/permissions.",
  ],
  requiredEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    pkce: true,
    refreshable: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    async accountLabel(_t, j) {
      if (typeof j.id_token !== "string") return "";
      try { return String(JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email ?? ""); } catch { return ""; }
    },
    async revoke(creds, _env, f) {
      const t = creds.refresh_token ?? creds.access_token;
      await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
    },
  },
  docs: [
    "https://developers.google.com/identity/protocols/oauth2/web-server",
    "https://developers.google.com/gmail/api/reference/rest",
    "https://developers.google.com/calendar/api/v3/reference",
    "https://developers.google.com/drive/api/reference/rest/v3",
  ],
  todo: ["gmail.readonly, gmail.compose and drive.readonly are restricted/sensitive scopes: public use needs Google's OAuth verification (and a security assessment for restricted scopes). In Testing mode only listed test users can connect."],
  getTools: (conn: ConnectionInfo) => {
    const granted = new Set(conn.scopes);
    return ALL_TOOLS.filter((t) => granted.has(t.scope)).map(({ scope: _s, ...t }) => { void _s; return t; });
  },
});
