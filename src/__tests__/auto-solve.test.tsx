/**
 * TimeBucks fixes: automatic Cloudflare solving before any pause, never "done" / never a saved session on a failed
 * check, navigation races retried, Google sign-in handed to the user, and earn tasks refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb, replies: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

import { decideNext, EARN_TASK_GOAL, GOOGLE_HANDOFF, type Snapshot } from "@/lib/server/autoBrowser";
import { isNavRace, passBotCheck, runAuto, LIVE_PROVIDERS } from "@/lib/server/cloudWorker";
import { capsolverToken, providerSolverOn, serviceToken } from "@/lib/server/autoSolve";
import { startSession } from "@/lib/server/remoteBrowser";
import { sessionProven } from "@/lib/loginCheck";
import { signinGoal, signinFailure } from "@/lib/signin";
import { POST } from "@/app/api/browser-jobs/worker/route";

const U = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const SECRET = "w".repeat(40);
const KEY = Buffer.alloc(32, 9).toString("base64");
const saved: Record<string, string | undefined> = {};
const KEYS = ["CONNECTOR_ENCRYPTION_KEY", "SESSION_WORKER_SECRET", "STEEL_SOLVE_CAPTCHA", "HYPERBROWSER_SOLVE_CAPTCHAS", "CF_SOLVER_URL", "CF_SOLVER_TOKEN", "CAPSOLVER_API_KEY"];
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY; process.env.SESSION_WORKER_SECRET = SECRET;
  h.replies = [];
  h.db = new FakeDb({ browser_jobs: [], messages: [], conversations: [{ id: "c1", user_id: U }], site_sessions: [], vault_secrets: [] });
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.restoreAllMocks(); });

const TB_LOGIN: Snapshot = {
  url: "https://timebucks.com/", title: "TimeBucks", text: "Login\nSign in with Google\nOR",
  elements: [{ i: 1, tag: "input", type: "text", text: "Email" }, { i: 2, tag: "input", type: "password", text: "Password" }, { i: 3, tag: "button", text: "Log In" }],
  bot: { frames: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc"], widget: true, solved: false },
};
const GOOGLE: Snapshot = { url: "https://accounts.google.com/v3/signin/identifier?continue=x", title: "Sign in - Google Accounts", text: "Sign in\nUse your Google Account\nEmail or phone", elements: [{ i: 0, tag: "input", type: "email", text: "Email or phone" }, { i: 1, tag: "button", text: "Next" }] };
const GOOGLE_BLOCKED_PAGE: Snapshot = { ...GOOGLE, text: "Couldn't sign you in\nThis browser or app may not be secure. Try using a different browser.", elements: [{ i: 0, tag: "button", text: "Try again" }] };

describe("earn tasks are refused (click fraud), sign-in is not", () => {
  it("matches paid-to-click / watch-ads / survey goals, in English and Hinglish", () => {
    for (const g of ["Open the tasks list on timebucks and complete the click tasks to earn money", "watch ads to earn coins", "do the paid-to-click offers", "timebucks pe tasks karo", "survey fill karo", "Complete surveys for points on TimeBucks", "open the offerwall"]) expect(EARN_TASK_GOAL.test(g), g).toBe(true);
    for (const g of ["Sign in to timebucks.com", signinGoal("timebucks.com", { siteLogin: "v1", check: "mera balance kitna hai" }), "Open the dashboard and read my balance", "Read the article and summarize it"]) expect(EARN_TASK_GOAL.test(g), g).toBe(false);
  });
  it("decideNext fails an earn-task goal with a short reason before any model call", async () => {
    const a = await decideNext("Go to timebucks.com tasks and complete the visit and click tasks to earn money", TB_LOGIN, [], [], 20);
    expect(a).toMatchObject({ do: "fail" });
    expect((a as { reason: string }).reason).toMatch(/^EARN_TASK_REFUSED: .*click fraud/);
    expect(signinFailure((a as { reason: string }).reason, "timebucks.com", "english").line).toMatch(/don't do paid-to-click/);
  });
});

describe("Cloudflare and Google with a live view: pause, never fail", () => {
  it("a check with a live view always pauses, however many times it paused before", async () => {
    const hist = ["wait: Cloudflare security check on the page (1/2)", "wait: Cloudflare security check on the page (2/2)", "need_user: Complete the check", "need_user: Complete the check", "need_user: Complete the check"];
    expect(await decideNext("Sign in to timebucks.com", { ...TB_LOGIN, can_pause: true }, [], hist, 20)).toMatchObject({ do: "need_user" });
    expect(await decideNext("Sign in to timebucks.com", TB_LOGIN, [], hist, 20)).toMatchObject({ do: "fail", reason: expect.stringMatching(/^CLOUDFLARE_BLOCKED/) });
  });
  it("a Google sign-in page with a live view is handed to the user; without one a Google block fails honestly", async () => {
    expect(await decideNext("Sign in to timebucks.com with Google", { ...GOOGLE, can_pause: true }, [], [], 20)).toMatchObject({ do: "need_user", why: GOOGLE_HANDOFF });
    expect(await decideNext("Sign in to timebucks.com with Google", { ...GOOGLE_BLOCKED_PAGE, can_pause: true }, [], [], 20)).toMatchObject({ do: "need_user" });
    expect(await decideNext("Sign in to timebucks.com with Google", GOOGLE_BLOCKED_PAGE, [], [], 20)).toMatchObject({ do: "fail", reason: expect.stringMatching(/^GOOGLE_BLOCKED/) });
    const three = [1, 2, 3].map(() => `need_user: ${GOOGLE_HANDOFF}`);
    expect(await decideNext("Sign in", { ...GOOGLE_BLOCKED_PAGE, can_pause: true }, [], three, 20)).toMatchObject({ do: "fail" });
  });
  it("Steel and Hyperbrowser are live-view providers", () => {
    expect(LIVE_PROVIDERS).toEqual(expect.arrayContaining(["steel", "hyperbrowser"]));
  });
});

/** A page whose Cloudflare box clears after `clearAfter` checks (Infinity = never). */
function cfPage(clearAfter = Infinity) {
  let checks = 0;
  const st = { reloads: 0, url: "https://timebucks.com/" };
  return {
    st,
    url: () => st.url, title: async () => "TimeBucks",
    frames: () => (checks < clearAfter ? [{ url: () => "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/x" }] : []),
    evaluate: async (fn: unknown) => {
      const src = String(fn);
      if (src.includes("pw")) { checks++; return { text: "Login Email Password", widget: checks <= clearAfter, solved: false, pw: true }; }
      return { els: [{ i: 0, tag: "a", text: "Logout" }], text: "Dashboard Logout" };
    },
    reload: async () => { st.reloads++; }, waitForTimeout: async () => undefined, waitForLoadState: async () => undefined,
    screenshot: async () => null,
  };
}
const JOBX = { id: JOB, mode: "auto", start_url: "https://timebucks.com/" };

describe("automatic solve layer runs before any pause", () => {
  it("a solver that clears the check means no reload and no pause", async () => {
    const page = cfPage(2);
    const hold = vi.fn(async () => undefined);
    const solve = vi.fn(async () => ({ ok: true }));
    await passBotCheck(page as never, JOBX, vi.fn(async () => ({})), { reloads: 0 }, 1, hold, solve);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(hold).not.toHaveBeenCalled();
    expect(page.st.reloads).toBe(0);
  });
  it("when every automatic attempt fails, it pauses (last fallback) instead of failing", async () => {
    const page = cfPage();
    const order: string[] = [];
    const solve = vi.fn(async () => { order.push("solve"); return { ok: false }; });
    const hold = vi.fn(async () => { order.push("hold"); });
    await passBotCheck(page as never, JOBX, vi.fn(async () => ({})), { reloads: 0 }, 1, hold, solve);
    expect(order[0]).toBe("solve");
    expect(order[order.length - 1]).toBe("hold");
    expect(hold).toHaveBeenCalledTimes(1);
  });
  it("provider solvers: one env var each, normal sessions too", async () => {
    process.env.STEEL_SOLVE_CAPTCHA = "1";
    expect(providerSolverOn("steel")).toBe(true);
    expect(providerSolverOn("hyperbrowser")).toBe(false);
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => { bodies.push(JSON.parse(String((init as RequestInit).body))); return new Response(JSON.stringify({ id: "sess-123456", debugUrl: "https://api.steel.dev/v1/sessions/sess-123456/player", websocketUrl: "wss://connect.steel.dev/x" })); });
    const s = await startSession("steel", { STEEL_API_KEY: "FAKE-steel-key-not-a-real-token", STEEL_SOLVE_CAPTCHA: "1" });
    expect(bodies[0]).toMatchObject({ solveCaptcha: true });
    expect(s.live?.interactive).toBe(true);
  });
  it("solver service and CapSolver are off unless configured, and send the sitekey + URL", async () => {
    const info = { sitekey: "0x4AAAAAAAFAKEKEY123", action: "login", cdata: null, callback: null, frame: null };
    const f = vi.fn(async (u: string | URL | Request) => new Response(JSON.stringify(String(u).includes("capsolver") ? (String(u).includes("createTask") ? { taskId: "t1" } : { status: "ready", solution: { token: "0.capsolver-token-xxxxxxxxxxxxxxxx" } }) : { token: "0.service-token-xxxxxxxxxxxxxxxxxxxx" })));
    expect(await serviceToken({}, "https://timebucks.com/", info, f as never)).toBeNull();
    expect(await capsolverToken({}, "https://timebucks.com/", info, f as never)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await serviceToken({ CF_SOLVER_URL: "https://solver.example", CF_SOLVER_TOKEN: "FAKE-solver-token" }, "https://timebucks.com/", info, f as never)).toMatch(/^0\.service-token/);
    expect(String(f.mock.calls[0][0])).toContain("sitekey=0x4AAAAAAAFAKEKEY123");
    expect(await capsolverToken({ CAPSOLVER_API_KEY: "FAKE-capsolver-key" }, "https://timebucks.com/", info, f as never, async () => undefined)).toMatch(/^0\.capsolver-token/);
  });
});

describe("navigation races retry the step", () => {
  it("'Execution context was destroyed' is a retry, not a crash", async () => {
    expect(isNavRace(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation"))).toBe(true);
    expect(isNavRace(new Error("Timeout 15000ms exceeded"))).toBe(false);
    let thrown = 0;
    const page = {
      url: () => "https://example.com/", title: async () => "Example", frames: () => [],
      goto: async () => null, waitForTimeout: async () => undefined, waitForLoadState: async () => undefined, screenshot: async () => null,
      evaluate: async (fn: unknown) => {
        if (String(fn).includes("data-target-i") && thrown < 2) { thrown++; throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation"); }
        if (String(fn).includes("pw")) return { text: "Hello", widget: false, solved: false, pw: false };
        return { els: [{ i: 0, tag: "a", text: "Home" }], text: "Hello world" };
      },
    };
    const api = vi.fn(async (b: Record<string, unknown>) => (b.action === "next" ? { action: { do: "done", result: "Read the page" } } : {}));
    const out = await runAuto({ ...JOBX, start_url: "https://example.com/", max_steps: 5 }, page as never, api, Date.now() + 60000, null, { solve: null });
    expect(out).toMatch(/^Read the page/);
    expect(thrown).toBe(2);
  });
});

describe("never done, never a saved session, without proof", () => {
  const call = (body: Record<string, unknown>) => POST(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const push = (log: string[], extra: Record<string, unknown> = {}) => h.db.rows("browser_jobs").push({ id: JOB, user_id: U, goal: "Sign in to timebucks.com", start_url: "https://timebucks.com/", steps: [], mode: "auto", max_steps: 30, status: "running", allowed_secrets: [], log, conversation_id: "c1", inputs: { signin: { site: "timebucks.com", via: "password", lang: "english" } }, claimed_at: new Date().toISOString(), ...extra });
  const job = () => h.db.rows("browser_jobs").find((r) => r.id === JOB)!;
  const COOKIES = [{ name: "sid", value: "abc", domain: ".timebucks.com", path: "/" }];

  it("sessionProven needs a server-verified sign-in line", () => {
    expect(sessionProven(["done"])).toBe(false);
    expect(sessionProven(["click [9]: Click the Cloudflare checkbox", "done: signed in, verified: page has \"Logout\""])).toBe(true);
  });
  it("the owner's 7f4f0c3d case: save_session is refused and finish(done) becomes failed", async () => {
    push(["click [9]: Click the Cloudflare human verification checkbox to enable login", "done"]);
    expect(await (await call({ action: "save_session", job_id: JOB, cookies: COOKIES })).json()).toMatchObject({ ok: false });
    expect(h.db.rows("site_sessions")).toHaveLength(0);
    await call({ action: "finish", job_id: JOB, status: "done", result: "TimeBucks login page loaded with saved credentials filled. Cloudflare security check failed to load, blocking login. Login not completed due to Cloudflare block." });
    expect(job().status).toBe("failed");
  });
  it("a sign-in done with no verified step is failed even when its text sounds fine", async () => {
    push(["click [3]: Log In", "done"]);
    await call({ action: "finish", job_id: JOB, status: "done", result: "Signed in, dashboard open" });
    expect(job().status).toBe("failed");
  });
  it("a verified sign-in saves the session and is done", async () => {
    push(["click [3]: Log In", "done: signed in, verified: page has \"Logout\""]);
    expect(await (await call({ action: "save_session", job_id: JOB, cookies: COOKIES })).json()).toMatchObject({ ok: true });
    await call({ action: "finish", job_id: JOB, status: "done", result: "Signed in. Balance $0.12" });
    expect(job().status).toBe("done");
  });
  it("any job: done on a Cloudflare challenge page is turned into a fail", async () => {
    h.db.rows("browser_jobs").push({ id: JOB, user_id: U, goal: "Read the page", start_url: "https://x.test/", steps: [], mode: "auto", max_steps: 30, status: "running", allowed_secrets: [], log: [], conversation_id: null, inputs: {}, claimed_at: new Date().toISOString() });
    h.replies = [JSON.stringify({ do: "done", result: "Read it" })];
    const r = await (await call({ action: "next", job_id: JOB, snapshot: { url: "https://x.test/", title: "Just a moment...", text: "Verifying you are human. This may take a few seconds.", elements: [] } })).json();
    // The challenge page gets a wait first (the worker's solver runs meanwhile), never a done.
    expect(r.action.do).not.toBe("done");
  });
});
