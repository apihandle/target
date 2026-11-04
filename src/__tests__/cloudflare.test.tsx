/**
 * Cloudflare / Turnstile in the browser worker: detect it, wait and reload at most twice, retry the job on the next
 * cloud browser in stealth mode, and when it still doesn't pass, stop with an honest CLOUDFLARE_BLOCKED reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  replies: [] as string[],
  // Per connected browser: does its page show the Cloudflare box?
  pages: [] as { blocked: boolean }[],
  connects: [] as string[],
}));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

function fakePage(blocked: boolean) {
  const state = { url: "https://timebucks.com/", reloads: 0 };
  return {
    state,
    url: () => state.url,
    title: async () => "Paid to Play Games | TimeBucks",
    frames: () => (blocked ? [{ url: () => "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/x" }] : []),
    evaluate: async (fn: unknown) => {
      // botSignals() asks for {text, widget, solved, pw}; snapshot() asks for {els, text}.
      const src = String(fn);
      if (src.includes("cf-turnstile-response")) return { text: "Login Email Password Log In", widget: blocked, solved: false, pw: true };
      return { els: blocked ? [{ i: 0, tag: "input", type: "password", text: "Password" }] : [{ i: 0, tag: "a", text: "Logout" }], text: blocked ? "Login" : "Dashboard Logout" };
    },
    goto: async () => null, reload: async () => { state.reloads++; return null; },
    waitForTimeout: async () => undefined, waitForLoadState: async () => undefined,
    screenshot: async () => null, setDefaultTimeout: () => undefined,
    locator: () => ({ first: () => ({ click: async () => undefined, fill: async () => undefined }) }),
    keyboard: { press: async () => undefined }, mouse: { wheel: async () => undefined },
    context: () => ({ storageState: async () => ({}) }),
  };
}
vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: async (ws: string) => {
      h.connects.push(ws.replace(/(apiKey|token)=[^&]+/g, "$1=***"));
      const spec = h.pages.shift() ?? { blocked: false };
      const page = fakePage(spec.blocked);
      const ctx = { pages: () => [page], newPage: async () => page, addCookies: async () => undefined, cookies: async () => [] };
      return { contexts: () => [ctx], newContext: async () => ctx, close: async () => undefined };
    },
  },
}));

import { blockingCheck, CloudflareBlocked, isCloudflareBlock, passBotCheck, runQueuedJobs } from "@/lib/server/cloudWorker";
import { startSession, STEALTH_ORDER } from "@/lib/server/remoteBrowser";
import { decideNext, type Snapshot } from "@/lib/server/autoBrowser";
import { signinFailure } from "@/lib/signin";

const ENV_KEYS = ["STEEL_API_KEY", "BROWSERLESS_TOKEN", "HYPERBROWSER_API_KEY", "ANCHOR_API_KEY", "BROWSERBASE_API_KEY", "BROWSER_PROVIDERS", "STEEL_SOLVE_CAPTCHA"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } h.replies = []; h.pages = []; h.connects = []; });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.restoreAllMocks(); });

const TIMEBUCKS: Snapshot = {
  url: "https://timebucks.com/", title: "TimeBucks", text: "Login\nSign in with Google\nOR",
  elements: [{ i: 1, tag: "input", type: "text", text: "Email" }, { i: 2, tag: "input", type: "password", text: "Password" }, { i: 3, tag: "button", text: "Log In" }],
  bot: { frames: ["https://challenges.cloudflare.com/turnstile/if/x"], widget: true, solved: false },
};

describe("detecting a check that blocks the job", () => {
  it("a challenge page always blocks; a Turnstile box only blocks a login form", () => {
    expect(blockingCheck({ title: "Just a moment...", text: "" })).toMatchObject({ kind: "page" });
    expect(blockingCheck({ title: "x", frames: ["https://challenges.cloudflare.com/t"], password: true })).toMatchObject({ kind: "widget" });
    expect(blockingCheck({ title: "x", frames: ["https://challenges.cloudflare.com/t"], password: false })).toBeNull();
    expect(blockingCheck({ title: "x", frames: ["https://challenges.cloudflare.com/t"], password: true, solved: true })).toBeNull();
    expect(isCloudflareBlock(new CloudflareBlocked("box", "timebucks.com"))).toBe(true);
    expect(isCloudflareBlock(new Error("CLOUDFLARE_BLOCKED: from the server"))).toBe(true);
    expect(isCloudflareBlock(new Error("timeout"))).toBe(false);
  });
});

describe("waiting and reloading", () => {
  const job = { id: "j", mode: "auto", start_url: "https://timebucks.com/" };
  it("reloads at most twice, then throws CLOUDFLARE_BLOCKED with the progress shown", async () => {
    const page = fakePage(true);
    const lines: string[] = [];
    const api = vi.fn(async (b: Record<string, unknown>) => { if (b.action === "progress") lines.push(String(b.line)); return {}; });
    await expect(passBotCheck(page as never, job, api, { reloads: 0 }, 1)).rejects.toThrow(/^CLOUDFLARE_BLOCKED: .*timebucks\.com/);
    expect(page.state.reloads).toBe(2);
    expect(lines.some((l) => /reloading the page \(2\/2\)/.test(l))).toBe(true);
  });
  it("does nothing on a clean page", async () => {
    const page = fakePage(false);
    await passBotCheck(page as never, job, vi.fn(async () => ({})), { reloads: 0 }, 1);
    expect(page.state.reloads).toBe(0);
  });
});

describe("server side (any worker)", () => {
  it("waits twice on a pending Turnstile login form, then fails with CLOUDFLARE_BLOCKED instead of refilling it", async () => {
    const secrets = [{ id: "11111111-1111-4111-8111-111111111111", kind: "login", label: "tb", site: "timebucks.com" }];
    const a1 = await decideNext("Sign in to timebucks.com", TIMEBUCKS, secrets, [], 30);
    expect(a1).toMatchObject({ do: "wait" });
    const a2 = await decideNext("Sign in to timebucks.com", TIMEBUCKS, secrets, [`wait: ${(a1 as { why: string }).why}`], 30);
    expect(a2).toMatchObject({ do: "wait" });
    const a3 = await decideNext("Sign in to timebucks.com", TIMEBUCKS, secrets, ["wait: Cloudflare security check on the page (1/2)", "wait: Cloudflare security check on the page (2/2)"], 30);
    expect(a3).toMatchObject({ do: "fail", reason: expect.stringMatching(/^CLOUDFLARE_BLOCKED/) });
  });
});

describe("stealth sessions", () => {
  it("opens Steel / Hyperbrowser / Browserless / Anchor in stealth mode, captcha solving only when switched on", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      bodies.push({ url: String(url), ...(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>) });
      return new Response(JSON.stringify({ id: "s1", websocketUrl: "wss://connect.steel.dev?sessionId=s1", wsEndpoint: "wss://hb/s1", data: { id: "a1", cdp_url: "wss://anchor/a1" } }), { status: 200 });
    });
    const steel = await startSession("steel", { STEEL_API_KEY: "k" }, { stealth: true });
    expect(steel).toMatchObject({ stealth: true, wsUrl: "wss://connect.steel.dev?sessionId=s1" });
    expect(bodies[0]).toMatchObject({ url: "https://api.steel.dev/v1/sessions", stealthConfig: { humanizeInteractions: true } });
    expect(bodies[0].solveCaptcha).toBeUndefined();
    await startSession("steel", { STEEL_API_KEY: "k", STEEL_SOLVE_CAPTCHA: "1" }, { stealth: true });
    expect(bodies[1].solveCaptcha).toBe(true);
    await startSession("hyperbrowser", { HYPERBROWSER_API_KEY: "h" }, { stealth: true });
    expect(bodies[2]).toMatchObject({ useStealth: true });
    expect(bodies[2].solveCaptchas).toBeUndefined();
    expect((await startSession("browserless", { BROWSERLESS_TOKEN: "t" }, { stealth: true })).wsUrl).toMatch(/&stealth=true$/);
    await startSession("anchor", { ANCHOR_API_KEY: "a" }, { stealth: true });
    expect(bodies[3]).toMatchObject({ browser: { extra_stealth: { active: true } } });
    expect(STEALTH_ORDER.slice(0, 4)).toEqual(["steel", "browserless", "hyperbrowser", "anchor"]);
  });
});

describe("retrying the job on the next cloud browser", () => {
  function workerApi(jobs: Record<string, unknown>[]) {
    const calls: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("api.steel.dev")) return new Response(JSON.stringify({ id: "s1", websocketUrl: "wss://connect.steel.dev?sessionId=s1" }));
      if (u.includes("api.hyperbrowser.ai")) return new Response(JSON.stringify({ id: "h1", wsEndpoint: "wss://hb/h1" }));
      const b = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push(b);
      if (b.action === "claim") return new Response(JSON.stringify({ job: jobs.shift() ?? null }));
      if (b.action === "next") return new Response(JSON.stringify({ action: { do: "done", result: "Signed in, dashboard shows Logout" } }));
      return new Response(JSON.stringify({ ok: true, cookies: [] }));
    });
    return calls;
  }
  const job = () => ({ id: "j1", mode: "auto", start_url: "https://timebucks.com/", max_steps: 40, allowed_secrets: ["v"], inputs: { signin: { site: "timebucks.com" } } });

  it("blocked on Steel, passes on Steel stealth: the job finishes done", async () => {
    process.env.STEEL_API_KEY = "k"; process.env.HYPERBROWSER_API_KEY = "h";
    h.pages = [{ blocked: true }, { blocked: false }];
    const calls = workerApi([job()]);
    const r = await runQueuedJobs({ budgetMs: 200000, secret: "s".repeat(40), base: "https://t.test" });
    expect(r).toEqual([{ id: "j1", ok: true, provider: "steel" }]);
    expect(h.connects).toEqual(["wss://connect.steel.dev?apiKey=***", "wss://connect.steel.dev?sessionId=s1"]);
    expect(calls.some((c) => c.action === "progress" && /Cloudflare blocked steel; retrying on steel in stealth mode/.test(String(c.line)))).toBe(true);
    expect(calls.find((c) => c.action === "finish")).toMatchObject({ status: "done" });
  });

  it("blocked everywhere: fails with CLOUDFLARE_BLOCKED, the browsers it tried, and an honest chat line", async () => {
    process.env.STEEL_API_KEY = "k"; process.env.HYPERBROWSER_API_KEY = "h";
    h.pages = [{ blocked: true }, { blocked: true }, { blocked: true }];
    const calls = workerApi([job()]);
    const r = await runQueuedJobs({ budgetMs: 200000, secret: "s".repeat(40), base: "https://t.test" });
    expect(r[0].ok).toBe(false);
    const fin = calls.find((c) => c.action === "finish")!;
    expect(fin.status).toBe("failed");
    expect(String(fin.error)).toMatch(/^CLOUDFLARE_BLOCKED: .*\(tried 3 cloud browsers: steel, steel \(stealth\), hyperbrowser \(stealth\)\)/);
    const line = signinFailure(String(fin.error), "timebucks.com", "hinglish").line;
    expect(line).toMatch(/Cloudflare security check ne cloud browser ko rok diya, isliye sign in nahi hua/);
    expect(line).toMatch(/3 cloud browser sessions/);
    expect(line).not.toMatch(/ho gaya/);
  });

  it("a page without a check is not retried", async () => {
    process.env.STEEL_API_KEY = "k";
    h.pages = [{ blocked: false }];
    workerApi([job()]);
    const r = await runQueuedJobs({ budgetMs: 200000, secret: "s".repeat(40), base: "https://t.test" });
    expect(r).toEqual([{ id: "j1", ok: true, provider: "steel" }]);
    expect(h.connects).toHaveLength(1);
  });
});
