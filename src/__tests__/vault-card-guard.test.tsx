/**
 * Security audit 2026-11-09, finding #2: a saved payment card must never ride along in a general
 * browser_task — the worker would hand its number, expiry and CVC to whatever site the task visits,
 * and in task mode / scheduled allow_browser jobs that release is auto-approved. Cards are released
 * only to checkout jobs, whose pay step is separately approval-gated. Both layers are pinned here:
 * the browser_task tool refuses card ids, and the worker secret endpoint refuses card fields for
 * non-checkout jobs (while logins keep working exactly as before).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => "", visionModels: () => [] }));

import { getBuiltin } from "@/lib/builtins/tools";
import { sealVault, vaultInput } from "@/lib/builtins/vault";
import { POST } from "@/app/api/browser-jobs/worker/route";

const U = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const LOGIN = "44444444-4444-4444-8444-444444444444";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "w".repeat(40);
const KEY = Buffer.alloc(32, 9).toString("base64");
const env = { key: undefined as string | undefined, secret: undefined as string | undefined };

beforeEach(() => {
  env.key = process.env.CONNECTOR_ENCRYPTION_KEY; env.secret = process.env.SESSION_WORKER_SECRET;
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY; process.env.SESSION_WORKER_SECRET = SECRET;
  const cardBox = sealVault(U, vaultInput.parse({ kind: "card", label: "HDFC card", number: "4242424242424242", expiry: "08/29", cvc: "123" })).secret_box;
  const loginBox = sealVault(U, vaultInput.parse({ kind: "login", label: "shop", site: "shop.example", username: "me@x.com", password: "hunter22" })).secret_box;
  h.db = new FakeDb({
    browser_jobs: [], approval_requests: [], messages: [], conversations: [{ id: "c1", user_id: U }],
    vault_secrets: [
      { id: CARD, user_id: U, kind: "card", label: "HDFC card", preview: "•••• 4242", secret_box: cardBox },
      { id: LOGIN, user_id: U, kind: "login", label: "shop", site: "shop.example", secret_box: loginBox },
    ],
  });
  h.db.as(U);
});
afterEach(() => {
  if (env.key === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = env.key;
  if (env.secret === undefined) delete process.env.SESSION_WORKER_SECRET; else process.env.SESSION_WORKER_SECRET = env.secret;
});

const ctx = () => ({ db: h.db.admin() as never, userId: U, conversationId: "c1" });
const call = (body: Record<string, unknown>) => POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const seedJob = (inputs: Record<string, unknown>) => h.db.rows("browser_jobs").push({
  id: JOB, user_id: U, goal: "task", start_url: "https://shop.example/", steps: [], mode: "auto", max_steps: 30,
  status: "running", allowed_secrets: [CARD, LOGIN], log: [], conversation_id: "c1", inputs, claimed_at: new Date().toISOString(),
});

describe("browser_task never carries a saved card", () => {
  it("refuses a card listed in secret_ids, before any job is created", async () => {
    await expect(getBuiltin("browser_task")!.execute(
      { goal: "Look at my account", start_url: "https://shop.example/", auto: true, secret_ids: [CARD], steps: [] }, ctx(),
    )).rejects.toThrow(/saved card/i);
    expect(h.db.rows("browser_jobs")).toHaveLength(0);
  });
  it("refuses a card hidden in a fixed fill_secret step", async () => {
    await expect(getBuiltin("browser_task")!.execute(
      { goal: "Fill the form", start_url: "https://shop.example/", auto: false, secret_ids: [], steps: [{ action: "fill_secret", selector: "#cc", secret_id: CARD, field: "number" }] }, ctx(),
    )).rejects.toThrow(/saved card/i);
    expect(h.db.rows("browser_jobs")).toHaveLength(0);
  });
  it("still accepts a saved login and sends it to approval as before", async () => {
    const out = await getBuiltin("browser_task")!.execute(
      { goal: "Sign in and check my orders", start_url: "https://shop.example/", auto: true, secret_ids: [LOGIN], steps: [] }, ctx(),
    ) as { __approval?: unknown };
    expect(out.__approval).toBeTruthy();
  });
});

describe("worker secret endpoint releases cards only to checkout jobs", () => {
  it("refuses card fields for a plain browser job", async () => {
    seedJob({});
    const r = await call({ action: "secret", job_id: JOB, secret_id: CARD, field: "number" });
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("4242424242424242");
  });
  it("still releases a login password to the job it belongs to", async () => {
    seedJob({});
    const r = await call({ action: "secret", job_id: JOB, secret_id: LOGIN, field: "password" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ value: "hunter22" });
  });
  it("releases card fields to a checkout job", async () => {
    seedJob({ checkout: { phase: "pay", site: "shop.example", merchant: "Shop", items: [] } });
    const r = await call({ action: "secret", job_id: JOB, secret_id: CARD, field: "number" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ value: "4242424242424242" });
  });
});
