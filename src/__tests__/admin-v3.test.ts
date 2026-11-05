// @vitest-environment node
// Admin v3: job Stop / Retry, approvals log with the Task mode flag, vault labels only, Task mode per user, provider status.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

type U = { id: string; email: string; created_at: string; email_confirmed_at?: string | null; app_metadata?: Record<string, unknown> };
const ADMIN: U = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.com", created_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: { provider: "email" } };
const BOB: U = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "bob@x.test", created_at: "2026-11-04T00:00:00Z", email_confirmed_at: "2026-11-04T00:00:00Z", app_metadata: { provider: "google" } };

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown, kicks: 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.session } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { if (!h.admin) throw new Error("no service role"); return h.admin; } }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: async () => { h.kicks++; } }));

import * as jobRoute from "@/app/api/admin/jobs/[id]/route";
import * as taskModeRoute from "@/app/api/admin/users/[id]/task-mode/route";
import { loadApprovals, loadJobDetail, loadUserExtras } from "@/lib/server/adminData";
import { retryable } from "@/lib/adminConfig";
import { loadProviderStates, recordProviderResult, LIMIT_ERROR } from "@/lib/server/providerStatus";

const J = (n: number) => `1111111${n}-1111-4111-8111-111111111111`;
let db: FakeDb;
const users = [ADMIN, BOB];
let savedAdmins: string | undefined;

function adminDb(seed: Record<string, Record<string, unknown>[]>) {
  const d = new FakeDb(seed);
  d.bypass = true;
  Object.defineProperty(d, "auth", { value: { getUser: async () => ({ data: { user: null } }), admin: { listUsers: async () => ({ data: { users }, error: null }), getUserById: async (id: string) => ({ data: { user: users.find((u) => u.id === id) ?? null }, error: null }) } } });
  return d;
}
const post = (url: string, body?: unknown) => new Request(`http://t${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const job = (n: number, extra: Record<string, unknown>) => ({ id: J(n), user_id: BOB.id, goal: "Sign in to example.com", start_url: "https://example.com/", steps: [], mode: "auto", allowed_secrets: [], max_steps: 40, language: null, code: null, inputs: {}, conversation_id: null, log: ["Opening example.com", "click [2]"], created_at: "2026-11-05T10:00:00Z", ...extra });

beforeEach(() => {
  savedAdmins = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "owner@example.com";
  h.kicks = 0;
  db = adminDb({
    browser_jobs: [
      job(1, { status: "queued" }),
      job(2, { status: "running", control: "agent", frame: "QUJD", live: { provider: "steel", url: "https://api.steel.dev/v1/sessions/debug?interactive=true", interactive: true } }),
      job(3, { status: "failed", error: "CLOUDFLARE_BLOCKED", inputs: { signin: { site: "example.com" }, secret_hint: "s3cr3t-input" } }),
      job(4, { status: "failed", inputs: { checkout: { phase: "pay" } } }),
      job(5, { status: "done" }),
    ],
    conversations: [
      { id: "c1", user_id: BOB.id, task_mode: true }, { id: "c2", user_id: BOB.id, task_mode: false }, { id: "c3", user_id: ADMIN.id, task_mode: true },
    ],
    vault_secrets: [{ id: "v1", user_id: BOB.id, kind: "login", label: "timebucks", site: "timebucks.com", preview: "bo•••@x.test", secret_box: "SEALED", created_at: "2026-11-01T00:00:00Z" }],
    site_sessions: [{ id: "s1", user_id: BOB.id, domain: "timebucks.com", status: "active", encrypted_cookies: "SEALED", updated_at: "2026-11-02T00:00:00Z" }],
    approval_requests: [
      { id: "a1", user_id: BOB.id, action_type: "email_send", summary: "Send to asha", status: "executed", auto: true, payload: { body: "secret text" }, created_at: "2026-11-05T09:00:00Z" },
      { id: "a2", user_id: BOB.id, action_type: "connector_tool", summary: "Move 1 email to the Trash", status: "pending", auto: false, payload: {}, created_at: "2026-11-05T09:30:00Z" },
    ],
    admin_settings: [], admin_audit_log: [],
  });
  h.admin = db;
});
afterEach(() => { process.env.ADMIN_EMAILS = savedAdmins; });

describe("job Stop / Retry", () => {
  it("is 404 for non-admins and needs confirm", async () => {
    h.session = BOB;
    expect((await jobRoute.POST(post(`/api/admin/jobs/${J(1)}`, { action: "stop", confirm: true }), ctx(J(1)))).status).toBe(404);
    h.session = ADMIN;
    expect((await jobRoute.POST(post(`/api/admin/jobs/${J(1)}`, { action: "stop" }), ctx(J(1)))).status).toBe(400);
  });
  it("stop cancels a queued job and tells a running one to stop; both audited", async () => {
    h.session = ADMIN;
    expect(await (await jobRoute.POST(post(`/api/admin/jobs/${J(1)}`, { action: "stop", confirm: true }), ctx(J(1)))).json()).toMatchObject({ stopped: "cancelled" });
    expect(db.rows("browser_jobs").find((r) => r.id === J(1))!.status).toBe("cancelled");
    expect(await (await jobRoute.POST(post(`/api/admin/jobs/${J(2)}`, { action: "stop", confirm: true }), ctx(J(2)))).json()).toMatchObject({ stopped: "stopping" });
    expect(db.rows("browser_jobs").find((r) => r.id === J(2))!.control).toBe("stop");
    expect(db.rows("admin_audit_log").map((r) => r.action)).toEqual(["job.stop", "job.stop"]);
    expect((await jobRoute.POST(post(`/api/admin/jobs/${J(5)}`, { action: "stop", confirm: true }), ctx(J(5)))).status).toBe(409);
  });
  it("retry queues a failed sign-in again as a new job; never a checkout, never a done job", async () => {
    h.session = ADMIN;
    const r = await jobRoute.POST(post(`/api/admin/jobs/${J(3)}`, { action: "retry", confirm: true }), ctx(J(3)));
    expect(r.status).toBe(200);
    const { job_id } = await r.json();
    const copy = db.rows("browser_jobs").find((x) => x.id === job_id)!;
    expect(copy).toMatchObject({ status: "queued", user_id: BOB.id, goal: "Sign in to example.com" });
    expect(h.kicks).toBe(1);
    expect((await jobRoute.POST(post(`/api/admin/jobs/${J(4)}`, { action: "retry", confirm: true }), ctx(J(4)))).status).toBe(409);
    expect((await jobRoute.POST(post(`/api/admin/jobs/${J(5)}`, { action: "retry", confirm: true }), ctx(J(5)))).status).toBe(409);
  });
  it("retryable refuses money, sends and deletes", () => {
    expect(retryable({ status: "failed", goal: "Sign in to x.com" })).toBeNull();
    expect(retryable({ status: "failed", goal: "Buy the blue shoes" })).toMatch(/can't be retried/);
    expect(retryable({ status: "cancelled", goal: "Delete my old posts" })).toMatch(/can't be retried/);
    expect(retryable({ status: "failed", goal: "x", inputs: { booking: {} } })).toMatch(/can't be retried/);
    expect(retryable({ status: "running", goal: "x" })).toMatch(/Only a failed/);
  });
  it("detail shows log, control, screenshot and live view, never the inputs", async () => {
    const d = await loadJobDetail(db as never, J(2));
    expect(d).toMatchObject({ control: "agent", log: ["Opening example.com", "click [2]"], frame: "data:image/jpeg;base64,QUJD", live: { provider: "steel", interactive: true } });
    const f = await loadJobDetail(db as never, J(3));
    expect(JSON.stringify(f)).not.toContain("s3cr3t-input");
    expect(f).toMatchObject({ retry_block: null });
  });
});

describe("approvals log, vault labels, Task mode per user", () => {
  it("lists approvals with the auto flag and filters by it; payloads are never read", async () => {
    const all = await loadApprovals(db as never, { page: 1 });
    expect(all.rows.map((r) => [r.id, r.auto])).toEqual([["a2", false], ["a1", true]]);
    expect(JSON.stringify(all)).not.toContain("secret text");
    expect((await loadApprovals(db as never, { page: 1, auto: "auto" })).rows.map((r) => r.id)).toEqual(["a1"]);
  });
  it("vault and saved sign-ins: labels only", async () => {
    const x = await loadUserExtras(db as never, BOB.id);
    expect(x.vault).toEqual([{ label: "timebucks", kind: "login", site: "timebucks.com" }]);
    expect(x.sessions).toEqual([{ domain: "timebucks.com", status: "active", updated_at: "2026-11-02T00:00:00Z" }]);
    expect(x.taskModeChats).toBe(1);
    expect(JSON.stringify(x)).not.toMatch(/SEALED|bo•••/);
  });
  it("turns Task mode off / on in all of one user's chats only, audited", async () => {
    h.session = ADMIN;
    const off = await taskModeRoute.POST(post(`/api/admin/users/${BOB.id}/task-mode`, { on: false, confirm: true }), ctx(BOB.id));
    expect(await off.json()).toMatchObject({ ok: true, changed: 1 });
    expect(db.rows("conversations").map((c) => c.task_mode)).toEqual([false, false, true]);
    const on = await taskModeRoute.POST(post(`/api/admin/users/${BOB.id}/task-mode`, { on: true, confirm: true }), ctx(BOB.id));
    expect(await on.json()).toMatchObject({ changed: 2 });
    expect(db.rows("admin_audit_log").map((r) => r.action)).toEqual(["user.task_mode_off", "user.task_mode_on"]);
    h.session = BOB;
    expect((await taskModeRoute.POST(post(`/api/admin/users/${BOB.id}/task-mode`, { on: true, confirm: true }), ctx(BOB.id))).status).toBe(404);
  });
});

describe("provider status", () => {
  it("records starts and failures; a fresh credit error shows as a limit; keys only as set / missing", async () => {
    await recordProviderResult("steel", true);
    await recordProviderResult("browserless", false, "HTTP 429: concurrency limit reached");
    const s = await loadProviderStates(db as never, { STEEL_API_KEY: "FAKE_TEST_KEY", BROWSERLESS_TOKEN: "FAKE_TEST_KEY" });
    const by = Object.fromEntries(s.map((p) => [p.id, p]));
    expect(by.steel).toMatchObject({ keyPresent: true, limit: false });
    expect(by.steel.lastOkAt).toBeTruthy();
    expect(by.browserless).toMatchObject({ keyPresent: true, limit: true, lastError: "HTTP 429: concurrency limit reached" });
    expect(by.anchor).toMatchObject({ keyPresent: false, lastOkAt: null });
    expect(JSON.stringify(s)).not.toContain("FAKE_TEST_KEY");
    expect(LIMIT_ERROR.test("connect ECONNREFUSED")).toBe(false);
  });
});
