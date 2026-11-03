/**
 * Sending email through the user's Gmail: only through a server-side approval the owner taps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { executeToolCall, loadToolsForUser } from "@/lib/connectors/loadTools";
import { buildMime, parseAddresses } from "@/lib/connectors/google";
import { decideApproval, executeApproval } from "@/lib/server/approvals";
import { pickPlaybooks, AGENT_PLAYBOOKS } from "@/lib/playbooks";
import ApprovalCard, { emailOf } from "@/components/ApprovalCard";
import type { Db } from "@/lib/server/auth";
import type { Approval } from "@/lib/approvals";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", GOOGLE_OAUTH_CLIENT_ID: "g-client", GOOGLE_OAUTH_CLIENT_SECRET: "g-secret-value" };
const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const TOKEN = "ya29.test-google-token";
const saved: Record<string, string | undefined> = {};

const googleConn = (user: string, scopes = ["openid", "email", COMPOSE]) => ({
  id: `google-${user}`, user_id: user, connector_id: "google", status: "connected", scopes, account_label: "me@gmail.com",
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKEN }), parseKey(KEY)), created_at: "2026-10-01T00:00:00Z", last_used_at: null,
});
const ctxOf = (userId = A) => ({ db: h.db as unknown as Db, userId, projectId: null, conversationId: null, taskId: null });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MAIL = { to: "Boss@Example.com, hr@example.com", subject: "Chhutti ki request – शुक्रवार", body: "Namaste,\nShukravaar ko chhutti chahiye.\n\nVikash" };
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [googleConn(A)], tasks: [], approval_requests: [], activity_events: [], connector_oauth_states: [] });
  h.db.as(A);
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  cleanup();
});

describe("gmail_send tool", () => {
  it("is offered with the gmail.compose scope and always requires approval", async () => {
    const t = getConnector("google")!.getTools({ connector_id: "google", status: "connected", scopes: [COMPOSE], account_label: "" }).find((x) => x.name === "gmail_send")!;
    expect(t).toBeTruthy();
    expect(t.requiresApproval).toBe(true);
    const { tools } = await loadToolsForUser(A, h.db as unknown as Db);
    expect(tools.map((x) => x.def.name)).toContain("gmail_send");
  });

  it("validates recipients and builds a UTF-8 safe message without header injection", () => {
    expect(parseAddresses("a@x.com; B@x.com, a@x.com")).toEqual(["a@x.com", "b@x.com"]);
    expect(parseAddresses("not-an-email")).toBeNull();
    expect(parseAddresses(Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(","))).toBeNull();
    const mime = buildMime({ to: ["a@x.com"], subject: "Hi\r\nBcc: evil@x.com", body: "नमस्ते" });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toMatch(/^Subject: Hi Bcc: evil@x.com$/m);
    expect(buildMime({ to: ["a@x.com"], subject: "शुक्रवार", body: "x" })).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("नमस्ते");
  });

  it("never sends from the chat path: the call becomes a pending approval and Gmail isn't contacted", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const r = await executeToolCall({ ...ctxOf(), f }, "google__gmail_send", JSON.stringify(MAIL));
    expect(r.kind).toBe("approval");
    expect(f).not.toHaveBeenCalled();
    const ap = h.db.tables.approval_requests[0];
    expect(ap).toMatchObject({ user_id: A, action_type: "connector_tool", status: "pending", payload: { connector: "google", tool: "gmail_send", args: MAIL } });
    expect(ap.summary).toMatch(/^Send the email “Chhutti ki request/);
    expect(ap.summary).toMatch(/boss@example.com, hr@example.com/);
    expect(ap.destination).toBe("Google (me@gmail.com)");
  });

  it("rejects a bad address before any approval is created", async () => {
    const r = await executeToolCall(ctxOf(), "google__gmail_send", JSON.stringify({ ...MAIL, to: "boss at example" }));
    expect(r.kind).toBe("error");
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });

  it("sends exactly once after the owner approves; another user can't; rejecting sends nothing", async () => {
    const r = await executeToolCall(ctxOf(), "google__gmail_send", JSON.stringify(MAIL));
    if (r.kind !== "approval") throw new Error("expected approval");
    const f = vi.fn().mockResolvedValue(jsonRes({ id: "m1", threadId: "t1" }));
    vi.stubGlobal("fetch", f);

    expect((await executeApproval(h.db as unknown as Db, A, r.approvalId)).status).toBe(409); // still pending
    h.db.as(B);
    expect((await decideApproval(h.db as unknown as Db, B, r.approvalId, "approve")).status).toBe(404);
    h.db.as(A);
    expect(f).not.toHaveBeenCalled();

    const ok = await decideApproval(h.db as unknown as Db, A, r.approvalId, "approve");
    expect(ok.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const raw = decodeRaw(JSON.parse(init.body).raw);
    expect(raw).toMatch(/^To: boss@example.com, hr@example.com$/m);
    expect(h.db.tables.approval_requests[0].status).toBe("executed");
    expect(JSON.stringify(h.db.tables.approval_requests[0].result)).not.toContain(TOKEN);
    expect((await executeApproval(h.db as unknown as Db, A, r.approvalId)).status).toBe(409); // never twice
    expect(f).toHaveBeenCalledTimes(1);

    const r2 = await executeToolCall(ctxOf(), "google__gmail_send", JSON.stringify(MAIL));
    if (r2.kind !== "approval") throw new Error("expected approval");
    expect((await decideApproval(h.db as unknown as Db, A, r2.approvalId, "reject")).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("approval card for an email", () => {
  const approval = (status: Approval["status"]): Approval => ({
    id: "33333333-3333-4333-8333-333333333333", action_type: "connector_tool", summary: "Send the email “Hi” to a@x.com", destination: "Google (me@gmail.com)",
    payload: { connector: "google", tool: "gmail_send", args: { to: "a@x.com", subject: "Hi", body: "Line one\nLine two" } },
    status, project_id: null, conversation_id: null, task_id: null, decided_at: null, executed_at: null, result: null, error: null, created_at: "2026-11-03T00:00:00Z",
  });
  it("shows recipients, subject and the full text, and an Approve & send button", () => {
    render(<ApprovalCard id="33333333-3333-4333-8333-333333333333" initial={approval("pending")} />);
    expect(screen.getByText("Send an email")).toBeTruthy();
    expect(screen.getByText("To")).toBeTruthy();
    expect(screen.getByText("a@x.com")).toBeTruthy();
    expect(screen.getByText("Subject")).toBeTruthy();
    expect(screen.getByText(/Line one/)).toBeTruthy();
    expect(screen.getByTestId("approve-btn").textContent).toBe("Approve & send");
    expect(screen.getByText(/Nothing is sent until you approve/)).toBeTruthy();
  });
  it("only treats google gmail_send payloads as emails", () => {
    expect(emailOf({ connector: "slack", tool: "send_message", args: { to: "x", subject: "y", body: "z" } })).toBeNull();
    expect(emailOf(approval("pending").payload)).toEqual({ to: "a@x.com", subject: "Hi", body: "Line one\nLine two" });
  });
});

describe("drafting playbook", () => {
  it("sends only after the user says so, through the approval card, never guessing an address", () => {
    expect(pickPlaybooks("boss ko leave ka email likh do").map((p) => p.id)).toContain("drafting");
    const g = AGENT_PLAYBOOKS.find((p) => p.id === "drafting")!.guidance;
    expect(g).toMatch(/gmail_send/);
    expect(g).toMatch(/approval card/);
    expect(g).toMatch(/never guess an address/);
  });
});
