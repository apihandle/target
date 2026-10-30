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
/** Header injection guard for drafted mail. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

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
  { scope: SCOPES.gmailCompose, ...tool({
    name: "gmail_create_draft",
    description: "Create a Gmail draft (it is NOT sent; the user sends it from Gmail).",
    input: z.object({ to: z.string().email(), subject: z.string().max(300), body: z.string().max(50000) }),
    async execute(a, ctx) {
      const raw = b64url(`To: ${oneLine(a.to)}\r\nSubject: ${oneLine(a.subject)}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${a.body}`);
      const d = await apiFetch<{ id?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", f: ctx.fetch, headers: auth(ctx), body: { message: { raw } } });
      return { draft_id: d.id, note: "Draft saved in Gmail. It has not been sent." };
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
  description: "Search and read Gmail, write drafts, see and add Calendar events, and search and read Drive files.",
  auth: "oauth",
  scopes: ["openid", "email", SCOPES.gmailRead, SCOPES.gmailCompose, SCOPES.calendar, SCOPES.driveRead],
  capabilities: [
    "Search and read your email; create drafts (never sends)",
    "List calendar events; add events (asks you first)",
    "Search Drive and read documents",
  ],
  permissions: [
    "gmail.readonly: read your email. gmail.compose: create drafts (TARGET has no send tool).",
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
