// @vitest-environment node
// Admin kill-switches are honoured on the server: tool calls, approval execution, the browser worker queue,
// scheduled prompts (API + cron), custom providers (routes + chat routing).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));

import { executeToolCall } from "@/lib/connectors/loadTools";
import { executeApproval } from "@/lib/server/approvals";
import { clearAdminSettingsCache } from "@/lib/server/adminSettings";
import { resolvePick } from "@/lib/server/customProviders";
import { POST as workerPOST } from "@/app/api/browser-jobs/worker/route";
import { POST as scheduledPOST } from "@/app/api/scheduled/route";
import { GET as cronScheduled } from "@/app/api/cron/scheduled/route";
import { POST as customPOST } from "@/app/api/custom-providers/route";
import { POST as customTest } from "@/app/api/custom-providers/test/route";
import type { Db } from "@/lib/server/auth";

const U = "11111111-1111-4111-8111-111111111111";
const AP = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const CODE = "44444444-4444-4444-8444-444444444444";
const W_SECRET = "w".repeat(40);
const C_SECRET = "c".repeat(40);
const saved: Record<string, string | undefined> = {};

function off(features: Record<string, boolean>) {
  h.db.rows("admin_settings").push({ key: "features", value: features });
  clearAdminSettingsCache();
}

beforeEach(() => {
  for (const k of ["SESSION_WORKER_SECRET", "COMPUTE_WORKER_SECRET", "CRON_SECRET"]) saved[k] = process.env[k];
  process.env.SESSION_WORKER_SECRET = W_SECRET;
  delete process.env.COMPUTE_WORKER_SECRET;
  process.env.CRON_SECRET = C_SECRET;
  h.db = new FakeDb({
    approval_requests: [{ id: AP, user_id: U, action_type: "purchase", summary: "Buy backpack", destination: "saucedemo.com", payload: { browser_job_id: JOB }, status: "approved", decided_by: U, project_id: null, task_id: null, conversation_id: null }],
    browser_jobs: [
      { id: JOB, user_id: U, goal: "Order", mode: "auto", status: "needs_approval", steps: [], created_at: "2026-11-05T00:00:00Z" },
      { id: CODE, user_id: U, goal: "Run code", mode: "code", status: "queued", steps: [], created_at: "2026-11-05T00:00:01Z" },
      { id: "55555555-5555-4555-8555-555555555555", user_id: U, goal: "Read a page", mode: "steps", status: "queued", steps: [], created_at: "2026-11-05T00:00:02Z" },
    ],
    scheduled_jobs: [{ id: "66666666-6666-4666-8666-666666666666", user_id: U, title: "Digest", prompt: "x", cadence: "daily", weekday: null, time_of_day: "09:00", timezone: "Asia/Kolkata", status: "active", next_run_at: "2026-11-01T00:00:00Z", run_count: 0 }],
  });
  h.db.as(U);
  clearAdminSettingsCache();
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const ctx = () => ({ db: h.db as unknown as Db, userId: U, projectId: null, conversationId: null, taskId: null });

describe("tool calls", () => {
  it("browser off: browser_task / site_login / checkout / book are refused before anything is prepared", async () => {
    off({ browser: false });
    for (const t of ["target__browser_task", "target__site_login", "target__site_register", "target__checkout", "target__book"]) {
      const r = await executeToolCall(ctx(), t, { goal: "x", start_url: "https://example.com" });
      expect(r.kind).toBe("error");
      expect(JSON.parse(r.content)).toMatchObject({ error: "disabled_by_admin" });
    }
    expect(h.db.rows("browser_jobs")).toHaveLength(3); // nothing new queued
  });
  it("checkout off alone blocks checkout but not booking", async () => {
    off({ checkout: false });
    expect(JSON.parse((await executeToolCall(ctx(), "target__checkout", {})).content)).toMatchObject({ error: "disabled_by_admin", feature: "checkout" });
    expect(JSON.parse((await executeToolCall(ctx(), "target__book", {})).content).error).not.toBe("disabled_by_admin");
  });
  it("email send off blocks gmail send/reply/forward, not drafts", async () => {
    off({ email_send: false });
    for (const t of ["google__gmail_send", "google__gmail_reply", "google__gmail_forward", "google__gmail_send_draft"]) {
      expect(JSON.parse((await executeToolCall(ctx(), t, {})).content)).toMatchObject({ error: "disabled_by_admin", feature: "email_send" });
    }
    expect(JSON.parse((await executeToolCall(ctx(), "google__gmail_create_draft", {})).content).error).not.toBe("disabled_by_admin");
  });
  it("everything on (no settings row) → no admin refusal", async () => {
    const r = await executeToolCall(ctx(), "google__gmail_send", {});
    expect(r.content).not.toContain("disabled_by_admin");
  });
});

describe("approval execution", () => {
  it("an order approved earlier fails once checkout is switched off; the job is not queued", async () => {
    off({ checkout: false });
    const r = await executeApproval(h.db as unknown as Db, U, AP);
    expect(r.status).toBe(502);
    expect(String((r.body as { error: string }).error)).toContain("checkout is turned off");
    expect(h.db.rows("browser_jobs").find((j) => j.id === JOB)!.status).toBe("needs_approval");
    expect(h.db.rows("approval_requests")[0].status).toBe("failed");
  });
  it("with checkout on the same approval queues the job", async () => {
    const r = await executeApproval(h.db as unknown as Db, U, AP);
    expect(r.status).toBe(200);
    expect(h.db.rows("browser_jobs").find((j) => j.id === JOB)!.status).toBe("queued");
  });
});

describe("browser worker queue", () => {
  const claim = async (modes: string[]) => (await (await workerPOST(new Request("http://t/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${W_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", modes }) }))).json()).job;
  it("browser off: website jobs stay queued, code jobs still run", async () => {
    off({ browser: false });
    expect(await claim(["steps", "auto"])).toBeNull();
    expect((await claim(["steps", "auto", "code"]))?.id).toBe(CODE);
    expect(h.db.rows("browser_jobs").find((j) => j.mode === "steps")!.status).toBe("queued");
  });
  it("browser on: steps job is handed out", async () => {
    expect((await claim(["steps", "auto"]))?.mode).toBe("steps");
  });
});

describe("scheduled prompts", () => {
  it("POST /api/scheduled is refused when switched off", async () => {
    off({ scheduled: false });
    const r = await scheduledPOST(new Request("http://t/api/scheduled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Daily digest", cadence: "daily", time_of_day: "09:00", timezone: "Asia/Kolkata" }) }));
    expect(r.status).toBe(403);
    expect(h.db.rows("scheduled_jobs")).toHaveLength(1);
  });
  it("cron skips due jobs when switched off and records the heartbeat", async () => {
    off({ scheduled: false });
    const r = await cronScheduled(new Request("http://t/api/cron/scheduled", { headers: { Authorization: `Bearer ${C_SECRET}` } }));
    expect(await r.json()).toEqual({ ran: 0, disabled: true });
    expect(h.db.rows("scheduled_jobs")[0].run_count).toBe(0);
    expect(h.db.rows("admin_settings").find((s) => s.key === "cron:scheduled")!.value).toMatchObject({ ran: 0, by: "cron", disabled: true });
  });
  it("the admin marker is only trusted after the secret check", async () => {
    off({ scheduled: false });
    const bad = await cronScheduled(new Request("http://t/api/cron/scheduled", { headers: { Authorization: "Bearer nope", "x-target-run-by": "admin" } }));
    expect(bad.status).toBe(401);
    await cronScheduled(new Request("http://t/api/cron/scheduled", { headers: { Authorization: `Bearer ${C_SECRET}`, "x-target-run-by": "admin" } }));
    expect(h.db.rows("admin_settings").find((s) => s.key === "cron:scheduled")!.value).toMatchObject({ by: "admin" });
  });
});

describe("custom AI providers", () => {
  it("routes that add or call a provider are refused when switched off", async () => {
    off({ custom_providers: false });
    const body = JSON.stringify({ name: "X", baseUrl: "https://api.example.com/v1", apiKey: "k".repeat(20), models: ["m"] });
    expect((await customPOST(new Request("http://t/api/custom-providers", { method: "POST", headers: { "Content-Type": "application/json" }, body }))).status).toBe(403);
    expect((await customTest(new Request("http://t/api/custom-providers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body }))).status).toBe(403);
    expect(h.db.rows("custom_providers")).toHaveLength(0);
  });
  it("a custom pick falls back to Auto when switched off", async () => {
    off({ custom_providers: false });
    const p = await resolvePick(h.db.admin() as unknown as Db, U, "custom:77777777-7777-4777-8777-777777777777:my-model");
    expect(p).toMatchObject({ builtin: null, custom: null, id: null });
    expect(p.error).toContain("turned off");
  });
});
