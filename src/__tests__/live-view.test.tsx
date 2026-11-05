/**
 * Live browser view in chat and Take control: live-view URL selection and fallback, the pause / resume state machine,
 * a Cloudflare check pauses (instead of failing) when there is a live view, and the chat panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fakeSupabase").FakeDb,
  replies: [] as string[],
  pages: [] as { blocked: boolean; clearsAfter?: number }[],
  connects: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("@/lib/server/push", () => ({ sendPushToUser: () => Promise.resolve() }));
vi.mock("@/lib/llm", () => ({ llmText: async () => h.replies.shift() ?? "", visionModels: () => [] }));

/** A fake page whose Cloudflare box clears after `clearsAfter` checks (the user solved it), or never. */
function fakePage(blocked: boolean, clearsAfter = Infinity) {
  const state = { url: "https://timebucks.com/", checks: 0, reloads: 0 };
  const isBlocked = () => blocked && state.checks < clearsAfter;
  return {
    state,
    url: () => state.url,
    title: async () => "TimeBucks",
    frames: () => (isBlocked() ? [{ url: () => "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/x" }] : []),
    evaluate: async (fn: unknown) => {
      const src = String(fn);
      if (src.includes("cf-turnstile-response")) { const b = isBlocked(); state.checks++; return { text: "Login Email Password", widget: b, solved: false, pw: b }; }
      return { els: [{ i: 0, tag: "a", text: "Logout" }], text: "Dashboard Logout" };
    },
    goto: async () => null, reload: async () => { state.reloads++; return null; },
    waitForTimeout: async () => undefined, waitForLoadState: async () => undefined,
    screenshot: async () => Buffer.from("jpegbytes"), setDefaultTimeout: () => undefined,
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
      const page = fakePage(spec.blocked, spec.clearsAfter);
      const ctx = { pages: () => [page], newPage: async () => page, addCookies: async () => undefined, cookies: async () => [] };
      return { contexts: () => [ctx], newContext: async () => ctx, close: async () => undefined };
    },
  },
}));

import { CHECK_LINE, liveViewFrom, nextControl, safeLiveUrl, steelLiveUrl, viewMode, PAUSE_TIMEOUT, STOPPED } from "@/lib/liveView";
import { startSession } from "@/lib/server/remoteBrowser";
import { holdForUser, LiveLink, isHandoff, runQueuedJobs } from "@/lib/server/cloudWorker";
import { decideNext, type Snapshot } from "@/lib/server/autoBrowser";
import BrowserLiveCard from "@/components/BrowserLiveCard";
import { POST as worker } from "@/app/api/browser-jobs/worker/route";
import { POST as control } from "@/app/api/browser-jobs/[id]/control/route";
import { GET as live } from "@/app/api/browser-jobs/live/route";

const ENV_KEYS = ["STEEL_API_KEY", "BROWSERLESS_TOKEN", "HYPERBROWSER_API_KEY", "ANCHOR_API_KEY", "BROWSERBASE_API_KEY", "BROWSER_PROVIDERS", "SESSION_WORKER_SECRET"];
const saved: Record<string, string | undefined> = {};
const U = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const CONV = "44444444-4444-4444-8444-444444444444";
const SECRET = "w".repeat(40);
const STEEL_DEBUG = "https://api.steel.dev/v1/sessions/s1/player/test-not-a-real-token";

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  h.replies = []; h.pages = []; h.connects = [];
  h.db = new FakeDb({ browser_jobs: [], messages: [], conversations: [{ id: CONV, user_id: U }], vault_secrets: [] });
  h.db.as(U);
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("live-view URL selection and fallback", () => {
  it("picks each provider's interactive live view", () => {
    expect(liveViewFrom("steel", { debugUrl: STEEL_DEBUG })).toEqual({ provider: "steel", url: `${STEEL_DEBUG}?interactive=true&showControls=false`, interactive: true });
    expect(liveViewFrom("hyperbrowser", { liveUrl: "https://dp-us-east-1.hxproxy.io/browser/h1/live/vnc.html?token=test-not-a-real-key" })?.interactive).toBe(true);
    expect(liveViewFrom("anchor", { data: { live_view_url: "https://live.anchorbrowser.io/a1" } })?.url).toBe("https://live.anchorbrowser.io/a1");
    expect(liveViewFrom("browserbase", { debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/x" })?.provider).toBe("browserbase");
    expect(liveViewFrom("browserless", { liveURL: "https://production-sfo.browserless.io/live/x" })?.provider).toBe("browserless");
    expect(steelLiveUrl(`${STEEL_DEBUG}?interactive=false`)).toContain("interactive=true");
  });
  it("never frames another host, plain http, or nothing", () => {
    expect(liveViewFrom("steel", {})).toBeNull();
    expect(liveViewFrom("hyperbrowser", { liveUrl: "https://evil.example/vnc.html" })).toBeNull();
    expect(safeLiveUrl("http://api.steel.dev/x")).toBeNull();
    expect(safeLiveUrl("javascript:alert(1)")).toBeNull();
    expect(safeLiveUrl("https://user:pw@api.steel.dev/x")).toBeNull();
    expect(safeLiveUrl("https://api.steel.dev.evil.com/x")).toBeNull();
  });
  it("shows the live view while running, else screenshots, else nothing", () => {
    const lv = { provider: "steel", url: `${STEEL_DEBUG}?interactive=true`, interactive: true };
    expect(viewMode({ status: "running", live: lv, frame: "abc" })).toBe("iframe");
    expect(viewMode({ status: "running", live: null, frame: "abc" })).toBe("screens");
    expect(viewMode({ status: "running", live: { ...lv, interactive: false }, frame: "abc" })).toBe("screens");
    expect(viewMode({ status: "done", live: lv, frame: "abc" })).toBe("screens");
    expect(viewMode({ status: "running", live: null, frame: null })).toBe("none");
  });
  it("Steel sessions come from the API with their live view; the bare connect URL is the fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "s1", websocketUrl: "wss://connect.steel.dev?sessionId=s1", debugUrl: STEEL_DEBUG })));
    const s = await startSession("steel", { STEEL_API_KEY: "test-not-a-real-key" });
    expect(s).toMatchObject({ id: "s1", live: { provider: "steel", interactive: true } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 402 }));
    const f = await startSession("steel", { STEEL_API_KEY: "test-not-a-real-key" });
    expect(f.live).toBeUndefined();
    expect(f.wsUrl).toMatch(/^wss:\/\/connect\.steel\.dev\?apiKey=/);
  });
});

describe("pause / resume state machine", () => {
  const I = { interactive: true };
  it("allows only the right moves", () => {
    expect(nextControl("agent", "pause", I)).toBe("paused");
    expect(nextControl("agent", "pause", { interactive: false })).toBeNull();
    expect(nextControl("agent", "take", I)).toBe("user");
    expect(nextControl("agent", "take", { interactive: false })).toBeNull();
    expect(nextControl("paused", "take", I)).toBe("user");
    expect(nextControl("paused", "continue", I)).toBe("agent");
    expect(nextControl("paused", "passed", I)).toBe("agent");
    expect(nextControl("paused", "timeout", I)).toBe("stop");
    expect(nextControl("user", "continue", I)).toBe("agent");
    expect(nextControl("user", "timeout", I)).toBe("agent");
    expect(nextControl("agent", "continue", I)).toBeNull();
    expect(nextControl(null, "stop", I)).toBe("stop");
    expect(nextControl("stop", "continue", I)).toBeNull();
  });

  function link(controls: string[], until = Date.now() + 60000) {
    const api = vi.fn(async (b: Record<string, unknown>) => {
      if (b.action === "pause") return { control: "paused", paused_until: until };
      if (b.action === "resume") return { control: "agent" };
      if (b.action === "control") return { control: controls.length ? controls.shift() : "paused" };
      return {};
    });
    const page = fakePage(false);
    const l = new LiveLink({ id: "j", mode: "auto", start_url: "https://a.com" }, api, page as never, { provider: "steel", url: STEEL_DEBUG, interactive: true });
    return { l, api, page };
  }
  it("Continue hands control back", async () => {
    const { l, api, page } = link(["paused", "user", "agent"]);
    await holdForUser(l, page as never, Date.now() + 200000, { reason: CHECK_LINE, every: 1 });
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ action: "pause", reason: CHECK_LINE }));
    expect(l.control).toBe("agent");
  });
  it("Stop ends the job", async () => {
    const { l, page } = link(["stop"]);
    await expect(holdForUser(l, page as never, Date.now() + 200000, { reason: CHECK_LINE, every: 1 })).rejects.toThrow(new RegExp(`^${STOPPED}`));
  });
  it("nobody acting within the window fails honestly", async () => {
    const { l, page } = link([], Date.now() - 1);
    await expect(holdForUser(l, page as never, Date.now() + 200000, { reason: CHECK_LINE, every: 1 })).rejects.toThrow(new RegExp(`^${PAUSE_TIMEOUT}`));
  });
  it("the check passing on its own resumes the agent", async () => {
    const { l, api, page } = link(["paused"]);
    await holdForUser(l, page as never, Date.now() + 200000, { reason: CHECK_LINE, check: async () => true, every: 1 });
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ action: "resume" }));
  });
  it("hands the session to the next run when this run's time is nearly up", async () => {
    const { l, page } = link([]);
    const e = await holdForUser(l, page as never, Date.now() + 1000, { reason: CHECK_LINE, every: 1 }).catch((x) => x);
    expect(isHandoff(e)).toBe(true);
  });
});

describe("Cloudflare pauses instead of failing", () => {
  function workerApi(jobs: Record<string, unknown>[], controls: string[]) {
    const calls: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("api.steel.dev")) return new Response(JSON.stringify({ id: "s1", websocketUrl: "wss://connect.steel.dev?sessionId=s1", debugUrl: STEEL_DEBUG }));
      if (u.includes("api.hyperbrowser.ai")) return new Response(JSON.stringify({ id: "h1", wsEndpoint: "wss://hb/h1" }));
      const b = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push(b);
      if (b.action === "claim") return new Response(JSON.stringify({ job: jobs.shift() ?? null }));
      if (b.action === "next") return new Response(JSON.stringify({ action: { do: "done", result: "Signed in, dashboard shows Logout" } }));
      if (b.action === "pause") return new Response(JSON.stringify({ control: "paused", paused_until: Date.now() + 300000 }));
      if (b.action === "frame") return new Response("{}");
      if (b.action === "control") return new Response(JSON.stringify({ control: controls.length ? controls.shift() : "paused" }));
      if (b.action === "resume") return new Response(JSON.stringify({ control: "agent" }));
      return new Response(JSON.stringify({ ok: true, cookies: [] }));
    });
    return calls;
  }
  const job = () => ({ id: "j1", mode: "auto", start_url: "https://timebucks.com/", max_steps: 40, allowed_secrets: ["v"], inputs: { signin: { site: "timebucks.com" } } });

  it("the user completes the check in the live view: no stealth retry, the job finishes", async () => {
    process.env.STEEL_API_KEY = "test-not-a-real-key"; process.env.HYPERBROWSER_API_KEY = "test-not-a-real-key";
    // Blocked for the waits, the automatic solve attempts and the reloads, then cleared (the user solved it) during the pause.
    h.pages = [{ blocked: true, clearsAfter: 9 }];
    const calls = workerApi([job()], ["agent", "paused", "paused", "paused"]);
    const r = await runQueuedJobs({ budgetMs: 200000, secret: SECRET, base: "https://t.test" });
    expect(r).toEqual([{ id: "j1", ok: true, provider: "steel" }]);
    expect(h.connects).toHaveLength(1);
    expect(calls.find((c) => c.action === "live")).toMatchObject({ live: { provider: "steel", interactive: true } });
    expect(calls.find((c) => c.action === "pause")).toMatchObject({ reason: CHECK_LINE });
    expect(calls.some((c) => c.action === "progress" && /retrying on/.test(String(c.line)))).toBe(false);
    expect(calls.find((c) => c.action === "finish")).toMatchObject({ status: "done", shot: expect.any(String) });
  });

  it("the server pauses (need_user) instead of failing when the worker can pause", async () => {
    const snap: Snapshot = {
      url: "https://timebucks.com/", title: "TimeBucks", text: "Login", can_pause: true,
      elements: [{ i: 1, tag: "input", type: "password", text: "Password" }],
      bot: { frames: ["https://challenges.cloudflare.com/turnstile/if/x"], widget: true, solved: false },
    };
    const a = await decideNext("Sign in to timebucks.com", snap, [], ["wait: Cloudflare security check on the page (1/2)", "wait: Cloudflare security check on the page (2/2)"], 30);
    expect(a).toMatchObject({ do: "need_user", why: CHECK_LINE });
    const b = await decideNext("Sign in to timebucks.com", { ...snap, can_pause: false }, [], ["wait: Cloudflare security check on the page (1/2)", "wait: Cloudflare security check on the page (2/2)"], 30);
    expect(b).toMatchObject({ do: "fail", reason: expect.stringMatching(/^CLOUDFLARE_BLOCKED/) });
  });
});

describe("worker and owner API", () => {
  const post = (body: Record<string, unknown>) => worker(new Request("https://t.test/api/browser-jobs/worker", { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const own = (action: string) => control(new Request(`https://t.test/api/browser-jobs/${JOB}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ id: JOB }) });
  beforeEach(() => {
    process.env.SESSION_WORKER_SECRET = SECRET;
    h.db.tables.browser_jobs = [{ id: JOB, user_id: U, goal: "Sign in to timebucks.com", start_url: "https://timebucks.com/", status: "running", mode: "auto", steps: [], allowed_secrets: [], max_steps: 40, log: [], conversation_id: CONV, inputs: {}, created_at: new Date().toISOString(), live: null, control: null, paused_until: null }];
  });

  it("stores only allow-listed live views, frames, and the pause; the owner takes control and continues", async () => {
    expect((await post({ action: "live", job_id: JOB, live: { provider: "x", url: "https://evil.example/x", interactive: true } })).status).toBe(400);
    expect((await post({ action: "live", job_id: JOB, live: { provider: "steel", url: STEEL_DEBUG, interactive: true } })).status).toBe(200);
    const fr = await (await post({ action: "frame", job_id: JOB, url: "https://timebucks.com/login", shot: "aGVsbG8=" })).json();
    expect(fr).toMatchObject({ control: "agent" });
    const p = await (await post({ action: "pause", job_id: JOB, reason: CHECK_LINE })).json();
    expect(p.control).toBe("paused");
    const row = h.db.tables.browser_jobs[0];
    expect(row).toMatchObject({ control: "paused", control_reason: CHECK_LINE, frame: "aGVsbG8=", frame_url: "https://timebucks.com/login" });
    expect(row.log).toContain(`Paused: ${CHECK_LINE}`);
    expect((await own("take")).status).toBe(200);
    expect(h.db.tables.browser_jobs[0].control).toBe("user");
    const lv = await (await live(new Request(`https://t.test/api/browser-jobs/live?c=${CONV}`))).json();
    expect(lv.job).toMatchObject({ mode: "iframe", control: "user", live: { provider: "steel" }, frame: null });
    expect((await own("continue")).status).toBe(200);
    expect(h.db.tables.browser_jobs[0].control).toBe("agent");
  });

  it("Stop ends the job as stopped, with the final screenshot", async () => {
    await own("stop");
    await post({ action: "finish", job_id: JOB, status: "failed", error: `${STOPPED}: Stopped by you`, shot: "ZmluYWw=" });
    expect(h.db.tables.browser_jobs[0]).toMatchObject({ status: "cancelled", frame: "ZmluYWw=", control: null });
    expect(String(h.db.tables.messages[0].content)).toMatch(/Browser task stopped|stopped/i);
  });

  it("can't take control without a live view", async () => {
    expect((await own("take")).status).toBe(409);
  });
});

describe("chat panel", () => {
  const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
  const base = { id: JOB, goal: "Sign in", start_url: "https://timebucks.com/", log: ["Opening timebucks.com", `Paused: ${CHECK_LINE}`], frame_url: "https://timebucks.com/login" };

  it("shows the interactive live view, current URL, the pause line, and Take control / Continue / Stop", async () => {
    const f = vi.fn().mockResolvedValue(ok({ job: { ...base, status: "running", live: { provider: "steel", url: `${STEEL_DEBUG}?interactive=true`, interactive: true }, control: "paused", control_reason: CHECK_LINE } }));
    vi.stubGlobal("fetch", f);
    render(<BrowserLiveCard conversationId={CONV} streaming firstDelayMs={0} pollMs={60000} />);
    expect(await screen.findByTestId("browser-live-frame")).toHaveAttribute("src", expect.stringContaining("api.steel.dev"));
    expect(screen.getByTestId("browser-live-url")).toHaveTextContent("timebucks.com/login");
    expect(screen.getByTestId("browser-paused")).toHaveTextContent(CHECK_LINE);
    expect(screen.getByTestId("browser-take")).toBeInTheDocument();
    expect(screen.getByTestId("browser-continue")).toBeInTheDocument();
    expect(screen.getByTestId("browser-stop")).toBeInTheDocument();
    f.mockResolvedValueOnce(ok({ control: "user" }));
    fireEvent.click(screen.getByTestId("browser-take"));
    await waitFor(() => expect(f).toHaveBeenCalledWith(`/api/browser-jobs/${JOB}/control`, expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "take" }) })));
    expect(await screen.findByTestId("browser-live-full")).toBeInTheDocument();
  });

  it("falls back to screenshots, and taps expand to full screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ job: { ...base, log: ["Opening timebucks.com"], status: "running", live: null, frame: "aGVsbG8=", control: "agent" } })));
    render(<BrowserLiveCard conversationId={CONV} streaming firstDelayMs={0} pollMs={60000} />);
    expect(await screen.findByTestId("browser-live-shot")).toHaveAttribute("src", "data:image/jpeg;base64,aGVsbG8=");
    expect(screen.queryByTestId("browser-take")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-live-expand"));
    expect(screen.getByTestId("browser-live-full")).toBeInTheDocument();
  });

  it("after the job ends: final screenshot and a truthful status", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ job: { ...base, status: "running", live: null, frame: "aGVsbG8=" } }))
      .mockResolvedValue(ok({ job: { ...base, status: "failed", error: "CLOUDFLARE_BLOCKED: check not completed", live: null, frame: "ZmluYWw=" } }));
    vi.stubGlobal("fetch", f);
    render(<BrowserLiveCard conversationId={CONV} streaming firstDelayMs={0} pollMs={1} />);
    expect(await screen.findByTestId("browser-final")).toHaveTextContent(/Cloudflare check could not be solved automatically.*Next: .*Take control/);
    expect(screen.getByTestId("browser-live-title")).toHaveTextContent("Failed");
    expect(screen.getByTestId("browser-live-shot")).toHaveAttribute("src", "data:image/jpeg;base64,ZmluYWw=");
    expect(screen.queryByTestId("browser-stop")).toBeNull();
  });
});
