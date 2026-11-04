import { z } from "zod";
import { ConnectorError, MissingScopeError } from "@/lib/connectors/http";
import type { ToolContext, ToolDef } from "@/lib/connectors/types";

/**
 * Shared plumbing for the Google connector (Gmail, Calendar, Drive, Sheets, Docs, Contacts).
 *
 * Scopes asked for today. `gmail.modify` covers reading, drafts, sending, labels, archive and trash (not permanent
 * delete); `calendar` covers calendars, events, RSVP and free/busy; `drive` covers Drive plus the Sheets and Docs
 * APIs; `contacts.readonly` + `contacts.other.readonly` let the agent look up email addresses by name.
 * https://developers.google.com/identity/protocols/oauth2/scopes
 */
const G = (s: string) => `https://www.googleapis.com/auth/${s}`;
export const SCOPES = {
  gmail: G("gmail.modify"),
  calendar: G("calendar"),
  drive: G("drive"),
  contacts: G("contacts.readonly"),
  otherContacts: G("contacts.other.readonly"),
};
/** What earlier connections were granted. Their tools keep working; newer ones say "Reconnect Google". */
export const LEGACY_SCOPES = {
  gmailRead: G("gmail.readonly"),
  gmailCompose: G("gmail.compose"),
  calendarEvents: G("calendar.events"),
  driveRead: G("drive.readonly"),
};
const MAIL = "https://mail.google.com/";

/** A tool's needs: every group must be satisfied by at least one granted scope. The first entry is the one to ask for. */
export type Need = string[][];
export const NEED = {
  gmailRead: [[SCOPES.gmail, LEGACY_SCOPES.gmailRead, MAIL]],
  gmailCompose: [[SCOPES.gmail, LEGACY_SCOPES.gmailCompose, MAIL]],
  gmailModify: [[SCOPES.gmail, MAIL]],
  calRead: [[SCOPES.calendar, LEGACY_SCOPES.calendarEvents, G("calendar.readonly"), G("calendar.events.readonly")]],
  calEvents: [[SCOPES.calendar, LEGACY_SCOPES.calendarEvents]],
  calList: [[SCOPES.calendar, G("calendar.readonly"), G("calendar.calendarlist.readonly")]],
  calFree: [[SCOPES.calendar, LEGACY_SCOPES.calendarEvents, G("calendar.readonly"), G("calendar.freebusy"), G("calendar.events.freebusy")]],
  driveRead: [[SCOPES.drive, LEGACY_SCOPES.driveRead]],
  driveCreate: [[SCOPES.drive, G("drive.file")]],
  driveWrite: [[SCOPES.drive]],
  sheetsRead: [[SCOPES.drive, G("spreadsheets"), G("spreadsheets.readonly"), LEGACY_SCOPES.driveRead]],
  sheetsWrite: [[SCOPES.drive, G("spreadsheets")]],
  docsRead: [[SCOPES.drive, G("documents"), G("documents.readonly"), LEGACY_SCOPES.driveRead]],
  docsWrite: [[SCOPES.drive, G("documents")]],
  contacts: [[SCOPES.contacts, G("contacts"), SCOPES.otherContacts]],
} satisfies Record<string, Need>;

export const shortScope = (s: string) => s.replace("https://www.googleapis.com/auth/", "");

/** The scope to ask for when `granted` doesn't cover `need` (null when it does). */
export function missingScope(granted: string[], need: Need): string | null {
  for (const group of need) if (!group.some((s) => granted.includes(s))) return shortScope(group[0]);
  return null;
}

export type GTool = ToolDef & { need: Need };

/**
 * Offer every tool, but one whose scope the connection lacks answers "Reconnect Google to allow this" (before any
 * approval card, and before any Google call). An empty scope list means "unknown" (very old rows): let Google decide.
 */
export function guardTool(t: GTool, granted: string[]): ToolDef {
  const { need, ...def } = t;
  const missing = granted.length ? missingScope(granted, need) : null;
  if (!missing) return def;
  const fail = async (): Promise<never> => { throw new MissingScopeError("google", "Google", missing); };
  return { ...def, prepare: fail, execute: fail };
}

// ------------------------------------------------------------------ HTTP

const API_NAMES: Record<string, string> = {
  "gmail.googleapis.com": "Gmail API", "www.googleapis.com": "Google API", "sheets.googleapis.com": "Google Sheets API",
  "docs.googleapis.com": "Google Docs API", "people.googleapis.com": "People API", "calendar": "Google Calendar API", "drive": "Google Drive API",
};
/** Which API a URL belongs to (www.googleapis.com hosts Calendar and Drive). */
export function apiOf(url: string): { name: string; service: string } {
  let host = "", path = "";
  try { const u = new URL(url); host = u.host; path = u.pathname; } catch { /* keep empty */ }
  if (host === "www.googleapis.com" && path.startsWith("/calendar/")) return { name: API_NAMES.calendar, service: "calendar-json.googleapis.com" };
  if (host === "www.googleapis.com" && (path.startsWith("/drive/") || path.startsWith("/upload/drive/"))) return { name: API_NAMES.drive, service: "drive.googleapis.com" };
  return { name: API_NAMES[host] ?? host, service: host };
}
/** Default scope to ask for when Google says the token's scopes are insufficient. */
function scopeFor(url: string): string {
  const { service } = apiOf(url);
  if (service.startsWith("gmail")) return "gmail.modify";
  if (service.startsWith("calendar")) return "calendar";
  if (service.startsWith("people")) return "contacts.readonly";
  return "drive";
}

type GErr = { error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string; metadata?: { service?: string } }[] } | string; error_description?: string };

/** Map a Google error response to a user-safe error: missing scope → Reconnect; API disabled → which API to enable. */
export function googleError(url: string, status: number, text: string): Error {
  let j: GErr = {};
  try { j = JSON.parse(text) as GErr; } catch { /* not JSON */ }
  const e = typeof j.error === "object" ? j.error : undefined;
  const message = String(e?.message || (typeof j.error === "string" ? j.error : "") || j.error_description || "").slice(0, 300);
  const reasons = [...(e?.errors ?? []).map((x) => x.reason ?? ""), ...(e?.details ?? []).map((x) => x.reason ?? "")];
  if (status === 403 && (reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || reasons.includes("insufficientPermissions") || /insufficient (authentication )?scopes/i.test(message)))
    return new MissingScopeError("google", "Google", scopeFor(url));
  if (status === 403 && (reasons.includes("SERVICE_DISABLED") || reasons.includes("accessNotConfigured") || /has not been used in project|is disabled/i.test(message))) {
    const api = apiOf(url);
    const service = e?.details?.find((d) => d.metadata?.service)?.metadata?.service ?? api.service;
    return new ConnectorError(`The ${api.name} (${service}) is not enabled in TARGET's Google Cloud project, so this can't run yet. The app owner must enable it at https://console.cloud.google.com/apis/library/${service} and then try again.`, 503, "provider");
  }
  let host = "Google";
  try { host = new URL(url).host; } catch { /* keep */ }
  const code = status === 401 ? "auth" : status === 403 ? "auth" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : status === 400 ? "invalid" : "provider";
  return new ConnectorError(`${host} returned ${status}${message ? `: ${message}` : ""}`, status, code);
}

type Body = { json: unknown } | { raw: BodyInit | Buffer; type: string };
type GInit = { method?: string; body?: Body; as?: "json" | "text" | "bytes"; timeoutMs?: number; maxBytes?: number };

/** One Google REST call with the user's token. */
export async function gcall<T = unknown>(ctx: ToolContext, url: string, init: GInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30000);
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}`, Accept: init.as === "json" || !init.as ? "application/json" : "*/*" };
  let body: BodyInit | undefined;
  if (init.body && "json" in init.body) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.body.json); }
  else if (init.body) { headers["Content-Type"] = init.body.type; const raw = init.body.raw; body = (Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw) as BodyInit; }
  let r: Response;
  try {
    r = await ctx.fetch(url, { method: init.method ?? "GET", headers, body, signal: ctrl.signal });
  } catch {
    clearTimeout(timer);
    throw new ConnectorError(`${apiOf(url).name} didn't respond in time`, 504);
  }
  try {
    if (!r.ok) throw googleError(url, r.status, await r.text().catch(() => ""));
    if (init.as === "bytes") {
      const max = init.maxBytes ?? 25 * 1024 * 1024;
      const len = Number(r.headers.get("content-length") ?? 0);
      if (len > max) throw new ConnectorError(`The file is larger than ${Math.round(max / 1048576)} MB`, 413, "invalid");
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > max) throw new ConnectorError(`The file is larger than ${Math.round(max / 1048576)} MB`, 413, "invalid");
      return buf as unknown as T;
    }
    const text = await r.text().catch(() => "");
    if (init.as === "text") return text as unknown as T;
    if (!text) return {} as T;
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  } finally { clearTimeout(timer); }
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** multipart/related body (Drive and Gmail media uploads): a JSON metadata part and one content part. */
export function multipartRelated(meta: unknown, content: Buffer, contentType: string): { raw: Buffer; type: string } {
  const boundary = `target_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return { raw: Buffer.concat([head, content, tail]), type: `multipart/related; boundary=${boundary}` };
}

// ------------------------------------------------------------------ ids and small helpers

export const fileId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/, "Not a Google Drive file id");
export const folderId = z.union([z.literal("root"), fileId]);
export const msgId = z.string().regex(/^[A-Za-z0-9]{6,64}$/, "Not a Gmail message id");
export const threadId = msgId;
export const draftId = z.string().regex(/^[A-Za-z0-9_-]{4,100}$/, "Not a Gmail draft id");
export const calendarId = z.string().regex(/^[A-Za-z0-9._%+@#-]{1,250}$/, "Not a calendar id").default("primary");
export const eventId = z.string().regex(/^[A-Za-z0-9_]{3,1024}$/, "Not a calendar event id");

export const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
/** Pull plain email addresses out of a header like `"Asha" <asha@x.com>, bob@y.com`. */
export function emailsIn(h: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (h ?? "").matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const e = m[0].toLowerCase();
    if (!out.includes(e)) out.push(e);
  }
  return out;
}
export const human = (n?: number | string) => {
  const b = Number(n ?? 0);
  if (!b) return "";
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};

/** Text out of a PDF (null when it has no text layer or can't be parsed). */
export async function pdfToText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const out = (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return out || null;
  } catch { return null; }
}

/** Readable text from file bytes, by MIME type. */
export async function bytesToText(bytes: Buffer, mime: string, name = ""): Promise<string | null> {
  const m = mime.toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return pdfToText(bytes);
  if (m.startsWith("text/html")) return bytes.toString("utf8").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (m.startsWith("text/") || /json|xml|csv|javascript|yaml|markdown/.test(m) || /\.(txt|md|csv|json|xml|ya?ml|log|ics|vcf)$/i.test(name)) {
    const t = bytes.toString("utf8");
    return t.includes("\u0000") ? null : t;
  }
  return null;
}
