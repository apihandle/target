/**
 * A sign-in is only reported as done when the page proves it. The owner's bug: timebucks.com showed a Cloudflare
 * "security check could not load" box, the browser model said "done ... login not completed", and the chat posted
 * "✓ timebucks.com pe sign in ho gaya". These tests pin the truthful path end to end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, replies: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

import { claimsSignedIn, detectBotCheck, resultSaysFailed, verifyLogin } from "@/lib/loginCheck";
import { signinFailure, signinHeadline, SIGNIN_PROMPT } from "@/lib/signin";
import { siteLoginTool } from "@/lib/builtins/signin";
import { POST } from "@/app/api/browser-jobs/worker/route";
import type { Snapshot } from "@/lib/server/autoBrowser";

const U = "11111111-1111-4111-8111-111111111111";
const LOGIN = "44444444-4444-4444-8444-444444444444";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "w".repeat(40);
const KEY = Buffer.alloc(32, 9).toString("base64");
const env = { key: undefined as string | undefined, secret: undefined as string | undefined };

// The owner's report, verbatim.
const OWNER_RESULT = "TimeBucks login page loaded with saved credentials filled (email vikash…@gmail.com, password filled). Cloudflare security check failed to load ('The security check could not load. Reload the page to try again.'), blocking login. Login not completed due to Cloudflare block.";

// timebucks.com's login modal as the worker sees it: the form is there and the Turnstile box sits inside an iframe.
const TIMEBUCKS: Snapshot = {
  url: "https://timebucks.com/", title: "Paid to Play Games, Paid To Watch Videos, Paid To do Surveys | TimeBucks",
  text: "Sign up Login Why join Timebucks? We've been paying out for 10 years.\nLogin\nSign in with Google\nOR\nForgot your password?\nDon't have an account? Sign Up Here!",
  elements: [{ i: 0, tag: "button", text: "Sign in with Google" }, { i: 1, tag: "input", type: "text", text: "Email", name: "email" }, { i: 2, tag: "input", type: "password", text: "Password", name: "password" }, { i: 3, tag: "button", text: "Log In" }],
  bot: { frames: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc"], widget: true, solved: false },
};
const SECURE: Snapshot = {
  url: "https://the-internet.herokuapp.com/secure", title: "The Internet",
  text: "You logged into a secure area!\n×\nSecure Area\nWelcome to the Secure Area. When you are done click logout below.\nLogout",
  elements: [{ i: 0, tag: "a", text: "Logout" }],
};

beforeEach(() => {
  env.key = process.env.CONNECTOR_ENCRYPTION_KEY; env.secret = process.env.SESSION_WORKER_SECRET;
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY; process.env.SESSION_WORKER_SECRET = SECRET;
  h.replies = [];
  h.db = new FakeDb({ browser_jobs: [], messages: [], conversations: [{ id: "c1", user_id: U }], site_sessions: [], vault_secrets: [{ id: LOGIN, user_id: U, kind: "login", label: "timebucks", site: "timebucks.com", secret_box: "x" }] });
  h.db.as(U);
});
afterEach(() => {
  if (env.key === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = env.key;
  if (env.secret === undefined) delete process.env.SESSION_WORKER_SECRET; else process.env.SESSION_WORKER_SECRET = env.secret;
});

const call = (body: Record<string, unknown>) => POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const job = () => h.db.rows("browser_jobs").find((r) => r.id === JOB)!;
function signinJob(site = "timebucks.com") {
  h.db.rows("browser_jobs").push({ id: JOB, user_id: U, goal: `Sign in to ${site}`, start_url: `https://${site}/`, steps: [], mode: "auto", max_steps: 30, status: "running", allowed_secrets: [LOGIN], log: ["fill_secret [1] username", "fill_secret [2] password", "click [3]: Log In", "fill_secret [1] username", "fill_secret [2] password", "click [3]: Log In"], conversation_id: "c1", inputs: { signin: { site, via: "password", goal: `Sign in to ${site}`, lang: "hinglish" } }, claimed_at: new Date().toISOString() });
}

describe("verifyLogin", () => {
  it("refuses the owner's timebucks page: Cloudflare box pending and the login form still there", () => {
    const v = verifyLogin(TIMEBUCKS, OWNER_RESULT);
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ code: "CLOUDFLARE_BLOCKED" });
  });
  it("accepts a page with a Logout link and the login form gone", () => {
    expect(verifyLogin(SECURE, "Welcome tomsmith! You logged into a secure area!")).toMatchObject({ ok: true });
  });
  it("refuses a page still showing the password box", () => {
    const form = { url: "https://x.com/login", title: "Login", text: "Login\nYour username is invalid!", elements: [{ tag: "input", type: "text", text: "Username" }, { tag: "input", type: "password", text: "Password" }] };
    expect(verifyLogin(form, "Signed in")).toMatchObject({ ok: false, code: "NOT_SIGNED_IN" });
  });
  it("refuses a login URL even without a form, and a summary that says it failed", () => {
    expect(verifyLogin({ url: "https://x.com/users/sign_in", elements: [] })).toMatchObject({ ok: false });
    expect(verifyLogin({ url: "https://x.com/home", elements: [{ tag: "a", text: "Help" }] }, "Login failed: account locked")).toMatchObject({ ok: false });
    expect(verifyLogin({ url: "https://x.com/home", elements: [{ tag: "a", text: "Help" }] }, "Opened the home page")).toMatchObject({ ok: true });
  });
});

describe("failure / success wording", () => {
  it.each([
    [OWNER_RESULT, true],
    ["Login not completed due to Cloudflare block.", true],
    ["Could not sign in: wrong password", true],
    ["The security check could not load, blocking login.", true],
    ["Still on the login page.", true],
    ["Signed in. Dashboard shows balance $2.10", false],
    ["Welcome tomsmith! You logged into a secure area!", false],
  ])("resultSaysFailed(%s) = %s", (t, want) => expect(resultSaysFailed(t)).toBe(want));

  it.each([
    ["✓ timebucks.com pe sign in ho gaya", true],
    ["Signed in to x.com, the dashboard shows 3 tasks.", true],
    ["Login ho gaya, balance $2 hai.", true],
    ["timebucks.com pe sign in nahi hua: Cloudflare check ne rok diya.", false],
    ["I could not sign in because of the Cloudflare check.", false],
    ["You are not logged in yet; save the login in the form below.", false],
  ])("claimsSignedIn(%s) = %s", (t, want) => expect(claimsSignedIn(t)).toBe(want));

  it("detects Cloudflare challenge pages and widgets", () => {
    expect(detectBotCheck({ title: "Just a moment..." })).toMatchObject({ kind: "page" });
    expect(detectBotCheck({ title: "Attention Required! | Cloudflare" })).toMatchObject({ kind: "page" });
    expect(detectBotCheck({ title: "x", text: "Verify you are human by completing the action below." })).toMatchObject({ kind: "page" });
    expect(detectBotCheck({ title: "TimeBucks", frames: ["https://challenges.cloudflare.com/turnstile/if/x"] })).toMatchObject({ kind: "widget" });
    expect(detectBotCheck({ title: "TimeBucks", frames: ["https://challenges.cloudflare.com/turnstile/if/x"], solved: true })).toBeNull();
    expect(detectBotCheck({ title: "Example", text: "Hello world" })).toBeNull();
  });
});

describe("the chat headline comes from the tool status", () => {
  it("only signed_in gets a ✓; failed shows the reason", () => {
    expect(signinHeadline({ status: "signed_in" }, "x.com", "hinglish")).toMatch(/^✓ \*\*x\.com pe sign in ho gaya/);
    const bad = signinHeadline({ status: "failed", reason: signinFailure("CLOUDFLARE_BLOCKED: Turnstile", "timebucks.com").line }, "timebucks.com", "hinglish");
    expect(bad).toMatch(/^⚠️ \*\*timebucks\.com pe sign in nahi hua\*\*/);
    expect(bad).toMatch(/Cloudflare/);
    expect(bad).not.toMatch(/✓/);
    expect(signinHeadline({ status: "needs_login" }, "x.com")).toBe("");
    expect(SIGNIN_PROMPT).toMatch(/Only say the user is signed in/);
  });
});

describe("worker API: an unverified done becomes a failure", () => {
  it("turns the owner's 'done' on the Cloudflare page into CLOUDFLARE_BLOCKED and posts a ⚠️ message, not ✓", async () => {
    signinJob();
    // An older worker that doesn't send the Cloudflare iframe signals: only the model's report shows the block.
    h.replies = [JSON.stringify({ do: "done", result: OWNER_RESULT })];
    const { bot: _bot, ...noSignals } = TIMEBUCKS;
    void _bot;
    const n = await (await call({ action: "next", job_id: JOB, snapshot: noSignals })).json();
    expect(n.action.do).toBe("fail");
    expect(n.action.reason).toMatch(/^CLOUDFLARE_BLOCKED/);
    await call({ action: "finish", job_id: JOB, status: "failed", error: n.action.reason });
    expect(job().status).toBe("failed");
    const msg = String(h.db.rows("messages").at(-1)?.content);
    expect(msg).toMatch(/⚠️ \*\*timebucks\.com pe sign in nahi hua\*\*/);
    expect(msg).toMatch(/Cloudflare/);
    expect(msg).not.toMatch(/sign in ho gaya/);
  });
  it("a worker that still finishes 'done' with a failure report is recorded as failed", async () => {
    signinJob();
    await call({ action: "finish", job_id: JOB, status: "done", result: OWNER_RESULT });
    expect(job().status).toBe("failed");
    expect(String(h.db.rows("messages").at(-1)?.content)).not.toMatch(/✓/);
  });
  it("a verified sign-in stays done and says what proved it", async () => {
    signinJob("the-internet.herokuapp.com");
    h.replies = [JSON.stringify({ do: "done", result: "Welcome tomsmith! You logged into a secure area!" })];
    const n = await (await call({ action: "next", job_id: JOB, snapshot: SECURE })).json();
    expect(n.action.do).toBe("done");
    expect((job().log as string[]).at(-1)).toMatch(/^done: signed in, verified: page has "Logout"/);
    await call({ action: "finish", job_id: JOB, status: "done", result: n.action.result });
    expect(String(h.db.rows("messages").at(-1)?.content)).toMatch(/^✓ \*\*the-internet\.herokuapp\.com pe sign in ho gaya/);
  });
});

describe("site_login tool result", () => {
  function fakeDb(row: { status: string; result: string | null; error: string | null }) {
    const db = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        Object.assign(q, { select: chain, eq: chain, limit: () => Promise.resolve({ data: table === "vault_secrets" ? [{ id: LOGIN, kind: "login", label: "timebucks", site: "timebucks.com" }] : [] }) });
        q.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: JOB } }) }) });
        q.maybeSingle = () => Promise.resolve({ data: { id: JOB, log: [], ...row } });
        return q;
      },
    };
    return db;
  }
  it("a 'done' job whose report says the login was blocked is ok:false / failed with the real reason", async () => {
    const out = await siteLoginTool.execute({ site: "timebucks.com", method: "password" }, { db: fakeDb({ status: "done", result: OWNER_RESULT, error: null }) as never, userId: U, conversationId: null }) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, status: "failed" });
    expect(String(out.reason)).toMatch(/Cloudflare/);
  });
  it("a failed job carries ok:false and a note forbidding a success claim", async () => {
    const out = await siteLoginTool.execute({ site: "timebucks.com", method: "password" }, { db: fakeDb({ status: "failed", result: null, error: "CLOUDFLARE_BLOCKED: Turnstile" }) as never, userId: U, conversationId: null }) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, status: "failed" });
    expect(String(out.note)).toMatch(/Never say signed in/);
  });
  it("a verified job is ok:true / signed_in", async () => {
    const out = await siteLoginTool.execute({ site: "timebucks.com", method: "password" }, { db: fakeDb({ status: "done", result: "Dashboard. Balance $2.10. Logout", error: null }) as never, userId: U, conversationId: null }) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, status: "signed_in" });
  });
});
