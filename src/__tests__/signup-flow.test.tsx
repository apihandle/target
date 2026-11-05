/**
 * Account creation on a site: approval card before anything is submitted, profile email/name on the form, a generated
 * password that never reaches the chat, logs or results, captchas pause for take-control, and an honest verdict.
 * Plus the rule that paid surveys / earn tasks are never filled with invented answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, replies: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => Object.defineProperty(h.db.admin(), "auth", {
    value: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com", user_metadata: { full_name: "Test Owner" } } } }) } },
  }),
}));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

import { siteRegisterTool } from "@/lib/builtins/siteAccount";
import { decideApproval } from "@/lib/server/approvals";
import { openVault } from "@/lib/builtins/vault";
import { accountGoal, withProfileName } from "@/lib/siteAccount";
import { verifySignup, NOT_CREATED } from "@/lib/loginCheck";
import { autoPrompt, SURVEY_RULE } from "@/lib/server/autoBrowser";
import { SYSTEM_PROMPT } from "@/lib/ai";
import { POST as worker } from "@/app/api/browser-jobs/worker/route";
import ApprovalCard from "@/components/ApprovalCard";
import type { Db } from "@/lib/server/auth";

const U = "11111111-1111-4111-8111-111111111111";
const CONV = "44444444-4444-4444-8444-444444444444";
const SECRET = "w".repeat(40);
const KEY = Buffer.alloc(32, 5).toString("base64");
const env: Record<string, string | undefined> = {};

beforeEach(() => {
  env.k = process.env.CONNECTOR_ENCRYPTION_KEY; env.s = process.env.SESSION_WORKER_SECRET;
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY; process.env.SESSION_WORKER_SECRET = SECRET;
  h.replies = [];
  h.db = new FakeDb({ browser_jobs: [], approval_requests: [], vault_secrets: [], connections: [], tasks: [], activity_events: [], messages: [], conversations: [{ id: CONV, user_id: U }] });
  h.db.as(U);
});
afterEach(() => {
  if (env.k === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = env.k;
  if (env.s === undefined) delete process.env.SESSION_WORKER_SECRET; else process.env.SESSION_WORKER_SECRET = env.s;
});

const ctx = () => ({ db: h.db.admin() as unknown as Db, userId: U, conversationId: CONV, userTexts: ["create my account on demo.example.com"] });
const post = (body: Record<string, unknown>) => worker(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("signup approval card", () => {
  it("shows a card before anything is submitted, with the profile email and name; no password exists yet", async () => {
    const out = await siteRegisterTool.execute({ site: "demo.example.com" }, ctx()) as { __approval: { id: string; summary: string } };
    expect(out.__approval.summary).toBe("Create a new account on demo.example.com with owner@example.com (name Test Owner). A strong password is generated and saved in your vault");
    expect(h.db.tables.browser_jobs[0]).toMatchObject({ status: "needs_approval", inputs: { account: { email: "owner@example.com", details: "name Test Owner" } } });
    expect(h.db.tables.vault_secrets).toHaveLength(0);
    const ap = h.db.tables.approval_requests[0];
    render(<ApprovalCard id={String(ap.id)} initial={{ ...ap, created_at: new Date().toISOString() } as never} />);
    expect(screen.getByText(/Create a new account on demo\.example\.com/)).toBeInTheDocument();
  });

  it("keeps a name the user gave", () => {
    expect(withProfileName("name Asha K", "Test Owner")).toBe("name Asha K");
    expect(withProfileName(undefined, "Test Owner")).toBe("name Test Owner");
    expect(withProfileName("city Pune", null)).toBe("city Pune");
  });
});

describe("the generated password never reaches output", () => {
  it("is sealed in the vault, typed only with fill_secret, and hidden from the result, error and chat", async () => {
    const out = await siteRegisterTool.execute({ site: "demo.example.com" }, ctx()) as { __approval: { id: string } };
    const r = await decideApproval(h.db as unknown as Db, U, out.__approval.id, "approve");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/password":\s*"[^"]{8,}/);
    const item = h.db.tables.vault_secrets[0];
    const pw = String(openVault(U, String(item.secret_box)).password);
    expect(pw.length).toBeGreaterThanOrEqual(20);
    const job = h.db.tables.browser_jobs[0];
    expect(job.status).toBe("queued");
    const goal = String((job.inputs as { account: { goal: string } }).account.goal);
    expect(goal).not.toContain(pw);
    expect(goal).toMatch(/fill_secret field "password"/);
    expect(goal).toMatch(/need_user/);
    // The worker runs it: the page echoes the password; the stored result and chat message hide it.
    job.status = "running";
    const fin = await post({ action: "finish", job_id: job.id, status: "done", result: `Account created. Your password is ${pw}` });
    expect(fin.status).toBe(200);
    const after = h.db.tables.browser_jobs[0];
    expect(String(after.result)).not.toContain(pw);
    expect(String(after.result)).toContain("[hidden]");
    for (const m of h.db.tables.messages) expect(String(m.content)).not.toContain(pw);
    expect(JSON.stringify(after.log ?? [])).not.toContain(pw);
  });
});

describe("signup verdict", () => {
  const form = { url: "https://demo.example.com/register", elements: [{ tag: "input", type: "email" }, { tag: "input", type: "password" }, { tag: "input", type: "password" }] };
  it("only reports created when the page proves it", () => {
    expect(verifySignup({ ...form, text: "Username already exists" })).toMatchObject({ ok: false, code: NOT_CREATED });
    expect(verifySignup({ ...form, text: "Register" })).toMatchObject({ ok: false, reason: "the sign-up form is still on the page" });
    expect(verifySignup({ url: "https://demo.example.com/welcome", elements: [], text: "Thanks for registering! Check your email to confirm." })).toMatchObject({ ok: true });
    expect(verifySignup({ url: "https://demo.example.com/login", elements: [{ tag: "a", text: "Home" }], text: "Login page" })).toMatchObject({ ok: true, evidence: "the sign-up form is gone" });
    expect(verifySignup({ url: "https://x", elements: [], text: "" }, "I could not create the account because of a captcha")).toMatchObject({ ok: false });
    expect(verifySignup({ ...form, title: "Just a moment...", text: "" })).toMatchObject({ ok: false, code: "CLOUDFLARE_BLOCKED" });
  });
  it("the worker turns an unproven 'done' into a fail", async () => {
    h.db.tables.browser_jobs = [{ id: "33333333-3333-4333-8333-333333333333", user_id: U, goal: "Create an account", start_url: "https://demo.example.com/", status: "running", mode: "auto", steps: [], allowed_secrets: [], max_steps: 40, log: [], conversation_id: CONV, inputs: { account: { flow: "register", site: "demo.example.com", email: "owner@example.com" } } }];
    h.replies = ['{"do":"done","result":"Account created"}'];
    const r = await (await post({ action: "next", job_id: "33333333-3333-4333-8333-333333333333", snapshot: { url: "https://demo.example.com/register", title: "Register", text: "Username already exists", elements: [{ i: 0, tag: "input", type: "password", text: "Password" }, { i: 1, tag: "button", text: "Register" }] } })).json();
    expect(r.action).toMatchObject({ do: "fail", reason: expect.stringMatching(/^ACCOUNT_NOT_CREATED/) });
  });
  it("account goals pause for a captcha instead of failing when a live view exists", () => {
    const g = accountGoal({ flow: "register", site: "demo.example.com", email: "a@example.com", vault_id: "v1" });
    expect(g).toMatch(/captcha[^.]*need_user/);
  });
});

describe("paid surveys / earn tasks", () => {
  it("are never done by the bot: no invented answers, no paid-to-click (browser and chat prompts)", () => {
    expect(SURVEY_RULE).toMatch(/never do paid-to-click, watch-ads, offerwall or paid-survey earn tasks/i);
    expect(SURVEY_RULE).toMatch(/no survey answers/i);
    expect(autoPrompt("Complete the survey", [], [], 10, true)).toContain(SURVEY_RULE);
    expect(autoPrompt("Complete the survey", [], [], 10, false)).toContain(SURVEY_RULE);
    expect(SYSTEM_PROMPT).toMatch(/paid-to-click, watch-ads-for-money, offerwall and paid-survey earn tasks/i);
    expect(SYSTEM_PROMPT).toMatch(/never do them with the browser/i);
    expect(SYSTEM_PROMPT).toMatch(/click fraud/i);
  });
});
