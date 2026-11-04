/**
 * Google connector: the everyday Gmail / Calendar / Drive / Sheets / Docs / Contacts set. Sends, shares and deletes
 * become approval cards (never run from the chat path) with server-built details; a connection that lacks a newer
 * scope answers "Reconnect Google to allow this" before any card or Google call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, safeFetch: null as unknown as (url: string) => Promise<Response> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/safeFetch", () => ({ safeFetch: (url: string) => h.safeFetch(url) }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { connectorViews, getConnector } from "@/lib/connectors/registry";
import { executeToolCall, loadToolsForUser, toOpenAITools, toolsPrompt } from "@/lib/connectors/loadTools";
import { SCOPES, LEGACY_SCOPES, google } from "@/lib/connectors/google";
import { LOGIN_SCOPES } from "@/lib/connectors/googleLoginScopes";
import { buildMime } from "@/lib/connectors/google/mime";
import { freeSlots } from "@/lib/connectors/google/calendar";
import { markdownToHtml, toCsv } from "@/lib/connectors/google/drive";
import { googleError } from "@/lib/connectors/google/shared";
import { isQuickTurn } from "@/lib/quick";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { decideApproval } from "@/lib/server/approvals";
import ApprovalCard from "@/components/ApprovalCard";
import type { Db } from "@/lib/server/auth";
import type { Approval } from "@/lib/approvals";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", GOOGLE_OAUTH_CLIENT_ID: "g-client", GOOGLE_OAUTH_CLIENT_SECRET: "g-secret-value" };
const TOKEN = "ya29.test-google-token";
const FULL = ["openid", "email", ...Object.values(SCOPES)];
const LEGACY = ["openid", "email", ...Object.values(LEGACY_SCOPES)];
const saved: Record<string, string | undefined> = {};

const gConn = (scopes = FULL) => ({
  id: "g-conn", user_id: A, connector_id: "google", status: "connected", scopes, account_label: "me@gmail.com",
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKEN }), parseKey(KEY)), created_at: "2026-11-01T00:00:00Z", last_used_at: null,
});
const ctxOf = () => ({ db: h.db as unknown as Db, userId: A, projectId: null, conversationId: null, taskId: null });

type Call = { method: string; url: string; path: string; body: string; json?: Record<string, unknown>; headers: Record<string, string> };
type Handler = (c: Call) => { status?: number; body?: unknown; raw?: string | Buffer; type?: string } | undefined;
/** A fake Google: key "METHOD host/path" (path prefix match with *) → response. Records every call. */
function googleApi(routes: Record<string, Handler | { status?: number; body?: unknown; raw?: string | Buffer; type?: string }>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body instanceof Uint8Array ? Buffer.from(init.body).toString("utf8") : String(init.body ?? "");
    let json: Record<string, unknown> | undefined;
    try { json = body ? JSON.parse(body) : undefined; } catch { json = undefined; }
    const c: Call = { method, url, path: `${u.host}${u.pathname}`, body, json, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(" "); return m === method && (p.endsWith("*") ? c.path.startsWith(p.slice(0, -1)) : c.path === p); });
    const r0 = key ? routes[key] : undefined;
    const r = (typeof r0 === "function" ? r0(c) : r0) ?? { status: 404, body: { error: { message: "Not Found" } } };
    const status = r.status ?? 200;
    if (r.raw !== undefined) return new Response(r.raw as unknown as BodyInit, { status, headers: { "Content-Type": r.type ?? "application/octet-stream" } });
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return { f, calls };
}
const GM = "gmail.googleapis.com/gmail/v1/users/me";
const CAL = "www.googleapis.com/calendar/v3/calendars/primary/events";
const FILES = "www.googleapis.com/drive/v3/files";
const hdrs = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
type ApRow = { id: string; summary: string; status: string; payload: { tool: string; args: Record<string, unknown>; preview?: { details: Record<string, string>; warning?: string } } };
const aps = () => h.db.tables.approval_requests as unknown as ApRow[];
const run = (tool: string, args: unknown) => executeToolCall(ctxOf(), `google__${tool}`, JSON.stringify(args));

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [gConn()], tasks: [], approval_requests: [], activity_events: [] });
  h.db.as(A);
  resetMemoryLimits();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  cleanup();
});

const EXPECTED = [
  // Gmail
  "gmail_search", "gmail_read", "gmail_list_threads", "gmail_read_thread", "gmail_read_attachment", "gmail_save_attachment_to_drive", "gmail_find_verification",
  "gmail_create_draft", "gmail_send", "gmail_reply", "gmail_reply_all", "gmail_forward", "gmail_list_drafts", "gmail_send_draft", "gmail_delete_draft",
  "gmail_list_labels", "gmail_create_label", "gmail_delete_label", "gmail_modify_labels", "gmail_archive", "gmail_mark_read", "gmail_star", "gmail_trash", "gmail_untrash",
  // Calendar
  "calendar_list_calendars", "calendar_list_events", "calendar_get_event", "calendar_create_event", "calendar_quick_add", "calendar_update_event", "calendar_delete_event", "calendar_rsvp", "calendar_find_free_time",
  // Drive
  "drive_search", "drive_list_folder", "drive_get_file", "drive_read", "drive_create_folder", "drive_upload_file", "drive_create_doc", "drive_create_sheet",
  "drive_move", "drive_rename", "drive_copy", "drive_share", "drive_unshare", "drive_trash", "drive_untrash", "drive_delete_permanently", "drive_export",
  // Sheets / Docs / Contacts
  "sheets_get_info", "sheets_read_range", "sheets_append_rows", "sheets_update_range", "sheets_add_tab", "docs_read", "docs_append_text", "docs_replace_text", "contacts_search",
];

describe("Google tool registry and scopes", () => {
  it("offers the full everyday set, every schema is a JSON object for the model, and the prompt describes it", async () => {
    const tools = google.getTools({ connector_id: "google", status: "connected", scopes: FULL, account_label: "" });
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
    const { tools: loaded, connected } = await loadToolsForUser(A, h.db as unknown as Db);
    const specs = toOpenAITools(loaded, connected).filter((s) => s.function.name.startsWith("google__"));
    expect(specs).toHaveLength(EXPECTED.length);
    for (const s of specs) expect(s.function.parameters).toMatchObject({ type: "object" });
    expect(toolsPrompt(loaded, connected)).toMatch(/GOOGLE: .*contacts_search.*has_other_guests/);
  });

  it("asks for gmail.modify, calendar, drive and contacts; login scopes match; old connections show Reconnect", () => {
    expect(google.scopes).toEqual(expect.arrayContaining([SCOPES.gmail, SCOPES.calendar, SCOPES.drive, SCOPES.contacts, SCOPES.otherContacts]));
    for (const s of Object.values(SCOPES)) expect(LOGIN_SCOPES.split(" ")).toContain(s);
    const v = connectorViews(ENV, [{ connector_id: "google", status: "connected", scopes: LEGACY, account_label: "me@gmail.com" }]).find((x) => x.id === "google")!;
    expect(v.needsReconnect).toEqual(expect.arrayContaining([SCOPES.gmail, SCOPES.drive]));
  });

  it("marks sends, shares and deletes as approval; reversible organising runs directly", () => {
    const tools = google.getTools({ connector_id: "google", status: "connected", scopes: FULL, account_label: "" });
    const needs = (n: string, args: unknown = {}) => { const t = tools.find((x) => x.name === n)!; return typeof t.requiresApproval === "function" ? t.requiresApproval(args as never) : !!t.requiresApproval; };
    for (const n of ["gmail_send", "gmail_reply", "gmail_reply_all", "gmail_forward", "gmail_send_draft", "gmail_delete_draft", "gmail_delete_label", "calendar_create_event", "calendar_quick_add", "calendar_rsvp", "drive_share", "drive_unshare", "drive_trash", "drive_delete_permanently"])
      expect([n, needs(n)]).toEqual([n, true]);
    for (const n of ["gmail_archive", "gmail_mark_read", "gmail_star", "gmail_modify_labels", "gmail_create_label", "gmail_untrash", "gmail_create_draft", "drive_move", "drive_rename", "drive_copy", "drive_create_doc", "drive_upload_file", "drive_export", "sheets_append_rows", "sheets_update_range", "docs_append_text", "contacts_search"])
      expect([n, needs(n)]).toEqual([n, false]);
    expect(needs("gmail_trash", { message_ids: ["abcdef1"] })).toBe(false);
    expect(needs("gmail_trash", { message_ids: ["abcdef1", "abcdef2"] })).toBe(true);
    expect(needs("calendar_update_event", { event_id: "e1" })).toBe(false);
    expect(needs("calendar_update_event", { event_id: "e1", has_other_guests: true })).toBe(true);
    expect(needs("calendar_update_event", { event_id: "e1", add_attendees: "a@x.com" })).toBe(true);
    expect(needs("calendar_delete_event", { event_id: "e1" })).toBe(false);
    expect(needs("calendar_delete_event", { event_id: "e1", has_other_guests: true })).toBe(true);
  });

  it("quick-turn routing keeps tools for Gmail/Calendar/Drive words", () => {
    for (const m of ["reply kar do", "forward this", "star it", "rsvp yes", "meeting kab hai", "contacts check"]) expect([m, isQuickTurn(m)]).toEqual([m, false]);
  });
});

describe("missing scopes → Reconnect Google", () => {
  beforeEach(() => { h.db.tables.connections = [gConn(LEGACY)]; });

  it("a legacy connection keeps its old tools working", async () => {
    const { calls } = googleApi({
      [`GET ${GM}/messages`]: { body: { messages: [{ id: "abcdef1" }] } },
      [`GET ${GM}/messages/abcdef1`]: { body: { id: "abcdef1", threadId: "t1", labelIds: ["UNREAD"], snippet: "hi", payload: { headers: hdrs({ From: "a@x.com", Subject: "Hello" }) } } },
    });
    const r = await run("gmail_search", { query: "is:unread" });
    expect(r.kind).toBe("result");
    expect(r.content).toContain("Hello");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("a tool needing a newer scope pauses with reconnect_required and never calls Google", async () => {
    const { f } = googleApi({});
    const r = await run("gmail_archive", { message_ids: ["abcdef1"] });
    expect(r).toMatchObject({ kind: "needs_connection", connector: "google", status: "missing_scope" });
    expect(JSON.parse(r.content)).toMatchObject({ error: "reconnect_required", missing_scope: "gmail.modify", reconnect_url: "/app/connectors?connect=google" });
    expect(String((r as { reason?: string }).reason)).toMatch(/^Reconnect Google to allow this/);
    expect(f).not.toHaveBeenCalled();
  });

  it("an approval tool with a missing scope makes no approval card", async () => {
    googleApi({});
    const r = await run("drive_share", { file_id: "file_abcdefghij", email: "a@x.com" });
    expect(r).toMatchObject({ kind: "needs_connection", status: "missing_scope" });
    expect(JSON.parse(r.content).missing_scope).toBe("drive");
    expect(aps()).toHaveLength(0);
  });

  it("Google's own insufficient-scope error also becomes Reconnect; a disabled API names the API to enable", async () => {
    h.db.tables.connections = [gConn([])]; // scopes unknown: let Google decide
    googleApi({ [`GET ${GM}/labels`]: { status: 403, body: { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } } });
    const r = await run("gmail_list_labels", {});
    expect(JSON.parse(r.content)).toMatchObject({ error: "reconnect_required", missing_scope: "gmail.modify" });
    const e = googleError("https://sheets.googleapis.com/v4/spreadsheets/x", 403, JSON.stringify({ error: { message: "Google Sheets API has not been used in project 123 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED", metadata: { service: "sheets.googleapis.com" } }] } }));
    expect(e.message).toMatch(/Google Sheets API \(sheets\.googleapis\.com\) is not enabled.*console\.cloud\.google\.com\/apis\/library\/sheets\.googleapis\.com/);
  });
});

describe("Gmail", () => {
  const original = { id: "orig123", threadId: "thr1", payload: { mimeType: "text/plain", headers: hdrs({ From: "Asha <asha@x.com>", To: "me@gmail.com, bob@y.com", Cc: "carol@z.com", Subject: "Plan", Date: "Mon, 2 Nov 2026 10:00:00 +0530", "Message-ID": "<m1@x.com>" }), body: { data: Buffer.from("Shall we meet?").toString("base64url") } } };

  it("reply-all: the card shows the computed recipients (never the user) and the send carries the thread headers", async () => {
    const { calls } = googleApi({
      [`GET ${GM}/messages/orig123`]: { body: original },
      [`GET ${GM}/profile`]: { body: { emailAddress: "me@gmail.com" } },
      [`POST ${GM}/messages/send`]: { body: { id: "sent1", threadId: "thr1" } },
    });
    const r = await run("gmail_reply_all", { message_id: "orig123", body: "Haan, 5 baje." });
    expect(r.kind).toBe("approval");
    expect(calls.some((c) => c.path.endsWith("/messages/send"))).toBe(false);
    const ap = aps()[0];
    expect(ap.summary).toMatch(/^Reply all to “Plan” → asha@x.com, bob@y.com, carol@z.com/);
    expect(ap.payload.preview!.details).toMatchObject({ to: "asha@x.com", cc: "bob@y.com, carol@z.com", subject: "Re: Plan", body: "Haan, 5 baje." });

    render(<ApprovalCard id={ap.id} initial={ap as unknown as Approval} />);
    expect(screen.getByText("Send an email")).toBeTruthy();
    expect(screen.getByText("bob@y.com, carol@z.com")).toBeTruthy();

    expect((await decideApproval(h.db as unknown as Db, A, ap.id, "approve")).status).toBe(200);
    const send = calls.find((c) => c.path.endsWith("/messages/send"))!;
    expect(send.json!.threadId).toBe("thr1");
    const raw = decode(String(send.json!.raw));
    expect(raw).toMatch(/^To: asha@x.com$/m);
    expect(raw).toMatch(/^Cc: bob@y.com, carol@z.com$/m);
    expect(raw).toMatch(/^In-Reply-To: <m1@x.com>$/m);
    expect(raw).toMatch(/^Subject: Re: Plan$/m);
    expect(aps()[0].status).toBe("executed");
  });

  it("send with a Drive attachment: the card names the file; after approval a Google Doc is attached as PDF", async () => {
    const { calls } = googleApi({
      [`GET ${FILES}/doc_abcdefghij`]: (c) => (c.url.includes("alt=media") ? undefined : { body: { name: "Resume", mimeType: "application/vnd.google-apps.document" } }),
      [`GET ${FILES}/doc_abcdefghij/export`]: { raw: Buffer.from("%PDF-1.4 fake"), type: "application/pdf" },
      [`POST ${GM}/messages/send`]: { body: { id: "s2", threadId: "t2" } },
    });
    const r = await run("gmail_send", { to: "hr@co.com", subject: "Application", body: "PFA", attachments: [{ drive_file_id: "doc_abcdefghij" }] });
    expect(r.kind).toBe("approval");
    expect(aps()[0].payload.preview!.details.Attachments).toBe("Resume (as PDF) — from Drive");
    expect(aps()[0].summary).toMatch(/with 1 attachment$/);
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    const raw = decode(String(calls.find((c) => c.path.endsWith("/messages/send"))!.json!.raw));
    expect(raw).toMatch(/Content-Type: multipart\/mixed/);
    expect(raw).toMatch(/Content-Disposition: attachment; filename="Resume.pdf"/);
    expect(raw).toContain(Buffer.from("%PDF-1.4 fake").toString("base64"));
  });

  it("attachments from a link go through the SSRF guard; a private address is refused", async () => {
    h.safeFetch = async () => { throw Object.assign(new Error("That address is private or local"), { name: "BlockedAddressError" }); };
    googleApi({});
    const r = await run("gmail_create_draft", { to: "a@x.com", subject: "x", body: "y", attachments: [{ url: "http://169.254.169.254/latest" }] });
    expect(r.kind).toBe("error");
    expect(r.content).toMatch(/private or local/);
    h.safeFetch = async () => new Response("col1,col2", { status: 200, headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="data.csv"' } });
    const { calls } = googleApi({ [`POST ${GM}/drafts`]: { body: { id: "r-123" } } });
    const ok = await run("gmail_create_draft", { to: "a@x.com", subject: "x", body: "y", attachments: [{ url: "https://example.com/d" }] });
    expect(ok.kind).toBe("result");
    expect(decode(String((calls[0].json!.message as { raw: string }).raw))).toContain('filename="data.csv"');
  });

  it("trash: one email goes right away; several need approval with their subjects listed", async () => {
    const { calls } = googleApi({
      [`POST ${GM}/messages/*`]: { body: {} },
      [`GET ${GM}/messages/*`]: (c) => ({ body: { id: c.path.split("/").pop(), payload: { headers: hdrs({ Subject: `S-${c.path.split("/").pop()}`, From: "x@y.com" }) } } }),
    });
    expect((await run("gmail_trash", { message_ids: ["abcdef1"] })).kind).toBe("result");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([`${GM}/messages/abcdef1/trash`]);
    const r = await run("gmail_trash", { message_ids: ["abcdef1", "abcdef2"] });
    expect(r.kind).toBe("approval");
    expect(aps()[0].payload.preview!.details.Emails).toContain("S-abcdef2");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("labels: missing user labels are created, then one batchModify; archive removes INBOX", async () => {
    const { calls } = googleApi({
      [`GET ${GM}/labels`]: { body: { labels: [{ id: "INBOX", name: "INBOX", type: "system" }] } },
      [`POST ${GM}/labels`]: { body: { id: "Label_9", name: "Invoices" } },
      [`POST ${GM}/messages/batchModify`]: { status: 204 },
    });
    const r = await run("gmail_modify_labels", { message_ids: ["abcdef1", "abcdef2"], add: ["Invoices", "starred"], remove: ["unread"] });
    expect(r.kind).toBe("result");
    expect(calls.find((c) => c.path.endsWith("batchModify"))!.json).toEqual({ ids: ["abcdef1", "abcdef2"], addLabelIds: ["Label_9", "STARRED"], removeLabelIds: ["UNREAD"] });
    await run("gmail_archive", { message_ids: ["abcdef3"] });
    expect(calls.filter((c) => c.path.endsWith("batchModify")).pop()!.json).toEqual({ ids: ["abcdef3"], removeLabelIds: ["INBOX"] });
  });

  it("reads a PDF/text attachment by part id", async () => {
    googleApi({
      [`GET ${GM}/messages/abcdef1`]: { body: { id: "abcdef1", payload: { mimeType: "multipart/mixed", parts: [{ partId: "0", mimeType: "text/plain", body: { data: Buffer.from("see attached").toString("base64url") } }, { partId: "1", mimeType: "text/csv", filename: "list.csv", body: { attachmentId: "att1", size: 9 } }] } } },
      [`GET ${GM}/messages/abcdef1/attachments/att1`]: { body: { data: Buffer.from("a,b\n1,2").toString("base64url") } },
    });
    const r = await run("gmail_read_attachment", { message_id: "abcdef1", part_id: "1" });
    expect(r.content).toContain("a,b");
  });

  it("buildMime keeps the plain single-part format and encodes non-ASCII file names", () => {
    const plain = buildMime({ to: ["a@x.com"], subject: "Hi", body: "x" });
    expect(plain).toMatch(/Content-Type: text\/plain; charset="UTF-8"/);
    const att = buildMime({ to: ["a@x.com"], bcc: ["b@x.com"], subject: "Hi", body: "x", attachments: [{ filename: "बिल.pdf", mimeType: "application/pdf", data: Buffer.from("1") }] });
    expect(att).toMatch(/^Bcc: b@x.com$/m);
    expect(att).toContain(`filename*=UTF-8''${encodeURIComponent("बिल.pdf")}`);
  });
});

describe("Calendar", () => {
  const ev = (attendees: unknown[] = []) => ({ id: "ev1", summary: "Standup", start: { dateTime: "2026-11-05T10:00:00+05:30" }, end: { dateTime: "2026-11-05T10:30:00+05:30" }, attendees });

  it("delete: a solo event goes right away; with guests the server refuses unless approved via has_other_guests", async () => {
    let guests: unknown[] = [];
    const { calls } = googleApi({ [`GET ${CAL}/ev1`]: () => ({ body: ev(guests) }), [`DELETE ${CAL}/ev1`]: { status: 204 } });
    expect((await run("calendar_delete_event", { event_id: "ev1" })).kind).toBe("result");
    expect(calls.find((c) => c.method === "DELETE")!.url).toContain("sendUpdates=none");
    guests = [{ email: "me@gmail.com", self: true }, { email: "asha@x.com" }];
    const refused = await run("calendar_delete_event", { event_id: "ev1" });
    expect(refused.kind).toBe("error");
    expect(refused.content).toMatch(/has_other_guests: true/);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    const r = await run("calendar_delete_event", { event_id: "ev1", has_other_guests: true });
    expect(r.kind).toBe("approval");
    expect(aps()[0].summary).toBe("Delete “Standup”");
    expect(aps()[0].payload.preview).toMatchObject({ details: { Guests: "asha@x.com" }, warning: "Guests get a cancellation email." });
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    expect(calls.filter((c) => c.method === "DELETE").pop()!.url).toContain("sendUpdates=all");
  });

  it("move keeps the duration; create supports guests, recurrence and a Meet link (approval)", async () => {
    const { calls } = googleApi({
      [`GET ${CAL}/ev1`]: { body: ev() },
      [`PATCH ${CAL}/ev1`]: (c) => ({ body: { ...ev(), ...c.json } }),
      [`GET www.googleapis.com/calendar/v3/calendars/primary`]: { body: { timeZone: "Asia/Kolkata" } },
      [`POST ${CAL}`]: { body: { id: "new1", htmlLink: "https://calendar.google.com/e", hangoutLink: "https://meet.google.com/abc" } },
    });
    expect((await run("calendar_update_event", { event_id: "ev1", start: "2026-11-05T12:00:00+05:30" })).kind).toBe("result");
    expect((calls.find((c) => c.method === "PATCH")!.json!.end as { dateTime: string }).dateTime).toBe("2026-11-05T07:00:00.000Z");
    const r = await run("calendar_create_event", { title: "Gym", start: "2026-11-06T07:00:00+05:30", end: "2026-11-06T08:00:00+05:30", attendees: "a@x.com", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], add_meet: true });
    expect(r.kind).toBe("approval");
    expect(aps()[0].summary).toBe("Add “Gym” to your Google Calendar (repeating) and invite 1 guest with a Meet link");
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toMatch(/conferenceDataVersion=1/);
    expect(post.url).toMatch(/sendUpdates=all/);
    expect(post.json).toMatchObject({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], attendees: [{ email: "a@x.com" }], start: { timeZone: "Asia/Kolkata" }, conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } } });
  });

  it("free slots skip busy blocks inside working hours in the user's zone", () => {
    const from = Date.parse("2026-11-05T00:00:00+05:30"), to = Date.parse("2026-11-06T00:00:00+05:30");
    const busy = [{ start: Date.parse("2026-11-05T10:00:00+05:30"), end: Date.parse("2026-11-05T11:30:00+05:30") }, { start: Date.parse("2026-11-05T13:00:00+05:30"), end: Date.parse("2026-11-05T17:00:00+05:30") }];
    expect(freeSlots(busy, { from, to, minutes: 60, zone: "Asia/Kolkata", dayStart: "09:00", dayEnd: "18:00", weekdaysOnly: false, max: 10 })).toEqual([
      { start: "2026-11-05T09:00:00+05:30", end: "2026-11-05T10:00:00+05:30" },
      { start: "2026-11-05T11:30:00+05:30", end: "2026-11-05T13:00:00+05:30" },
      { start: "2026-11-05T17:00:00+05:30", end: "2026-11-05T18:00:00+05:30" },
    ]);
  });
});

describe("Drive, Sheets, Docs, Contacts", () => {
  it("share needs approval with a link-sharing warning; trash lists files; create doc converts Markdown", async () => {
    const { calls } = googleApi({
      [`GET ${FILES}/file_abcdefghij`]: { body: { id: "file_abcdefghij", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" } },
      [`POST ${FILES}/file_abcdefghij/permissions`]: { body: { id: "p1" } },
      [`POST www.googleapis.com/upload/drive/v3/files`]: { body: { id: "d1", name: "Notes", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/d1" } },
    });
    expect((await run("drive_share", { file_id: "file_abcdefghij", anyone_with_link: true })).kind).toBe("approval");
    expect(aps()[0].payload.preview).toMatchObject({ details: { File: "Budget", Who: "Anyone with the link", Access: "Can view" }, warning: expect.stringMatching(/Anyone who gets the link/) });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    expect(calls.find((c) => c.path.endsWith("/permissions"))!.json).toEqual({ type: "anyone", role: "reader" });

    expect((await run("drive_trash", { file_ids: ["file_abcdefghij"] })).kind).toBe("approval");
    expect(aps()[1].payload.preview!.details.Files).toBe("• Budget");

    const d = await run("drive_create_doc", { title: "Notes", content: "# Plan\n- **one** <b>\n- two" });
    expect(d.kind).toBe("result");
    const up = calls.find((c) => c.path.startsWith("www.googleapis.com/upload/drive"))!;
    expect(up.body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(up.body).toContain("<h1>Plan</h1>");
    expect(up.body).toContain("<li><b>one</b> &lt;b&gt;</li>");
  });

  it("export saves a PDF next to the original", async () => {
    const { calls } = googleApi({
      [`GET ${FILES}/doc_abcdefghij`]: { body: { id: "doc_abcdefghij", name: "Report", mimeType: "application/vnd.google-apps.document", parents: ["fold_abcdefghij"] } },
      [`GET ${FILES}/doc_abcdefghij/export`]: { raw: Buffer.from("%PDF"), type: "application/pdf" },
      [`POST www.googleapis.com/upload/drive/v3/files`]: { body: { id: "pdf1", name: "Report.pdf", webViewLink: "https://drive.google.com/pdf1", webContentLink: "https://drive.google.com/dl" } },
    });
    const r = await run("drive_export", { file_id: "doc_abcdefghij", format: "pdf" });
    expect(r.content).toContain("Report.pdf");
    const up = calls.find((c) => c.method === "POST")!;
    expect(up.body).toContain('"parents":["fold_abcdefghij"]');
    expect(up.body).toContain("Content-Type: application/pdf");
  });

  it("sheets append to the first tab (quoted) and docs append at the end", async () => {
    const { calls } = googleApi({
      [`GET sheets.googleapis.com/v4/spreadsheets/sheet_abcdefghij`]: { body: { sheets: [{ properties: { title: "My Tab" } }] } },
      [`POST sheets.googleapis.com/v4/spreadsheets/sheet_abcdefghij/values/*`]: { body: { updates: { updatedRows: 1, updatedRange: "'My Tab'!A5:B5" } } },
      [`POST docs.googleapis.com/v1/documents/doc_abcdefghij:batchUpdate`]: { body: {} },
    });
    const r = await run("sheets_append_rows", { spreadsheet_id: "sheet_abcdefghij", rows: [["Milk", 40]] });
    expect(r.kind).toBe("result");
    const call = calls.find((c) => c.method === "POST" && c.path.includes("/values/"))!;
    expect(decodeURIComponent(call.url)).toContain("/values/'My Tab':append");
    expect(call.json).toEqual({ values: [["Milk", 40]] });
    await run("docs_append_text", { document_id: "doc_abcdefghij", text: "Done" });
    expect(calls.pop()!.json).toEqual({ requests: [{ insertText: { endOfSegmentLocation: { segmentId: "" }, text: "\nDone" } }] });
  });

  it("contacts search merges saved contacts and people emailed before", async () => {
    googleApi({
      [`GET people.googleapis.com/v1/people:searchContacts`]: (c) => ({ body: c.url.includes("query=Asha") ? { results: [{ person: { names: [{ displayName: "Asha Rao" }], emailAddresses: [{ value: "asha@x.com" }] } }] } : {} }),
      [`GET people.googleapis.com/v1/otherContacts:search`]: (c) => ({ body: c.url.includes("query=Asha") ? { results: [{ person: { names: [{ displayName: "Asha" }], emailAddresses: [{ value: "asha@x.com" }] } }, { person: { emailAddresses: [{ value: "asha.work@co.com" }] } }] } : {} }),
    });
    const r = await run("contacts_search", { query: "Asha" });
    const out = JSON.parse(r.content.replace(/^<untrusted_data[^>]*>\n|\n<\/untrusted_data>$/g, ""));
    expect(out.people.map((p: { emails: string[] }) => p.emails[0])).toEqual(["asha@x.com", "asha.work@co.com"]);
  });

  it("helpers: CSV quoting and HTML escaping", () => {
    expect(toCsv([["a,b", 'say "hi"', null, 3]])).toBe('"a,b","say ""hi""",,3');
    expect(markdownToHtml("[x](javascript:alert(1)) <script>")).not.toMatch(/<script>|href="javascript/);
  });

  it("the tool list from the registry matches the connector", () => {
    expect(getConnector("google")).toBe(google);
  });
});
