/**
 * Cloud browsers for the built-in worker (no server of our own needed).
 * Each provider gives a Chrome DevTools (CDP) WebSocket we drive with playwright-core.
 * Providers are tried in order; one that is unconfigured, out of credit, or down is skipped.
 *
 *   STEEL_API_KEY                               Steel.dev
 *   BROWSERLESS_TOKEN                           Browserless
 *   BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID Browserbase
 *   HYPERBROWSER_API_KEY                        Hyperbrowser
 *   ANCHOR_API_KEY                              Anchor Browser
 *   BROWSER_PROVIDERS="steel,browserless,..."   optional custom order
 */
import { liveViewFrom, type LiveView } from "@/lib/liveView";

type Env = Record<string, string | undefined>;

export type ProviderId = "steel" | "browserless" | "browserbase" | "hyperbrowser" | "anchor";
/**
 * id: the provider's session id when the session was created through its API (it outlives our connection, so a paused
 * job can hand it to the next worker run). live: the provider's interactive live view, when it has one.
 */
export interface CdpSession { provider: ProviderId; wsUrl: string; release: () => Promise<void>; stealth?: boolean; id?: string; live?: LiveView | null }
export interface SessionOpts { stealth?: boolean }

/**
 * Providers to retry on when a Cloudflare check blocks the browser, in order. Each is opened in its stealth mode.
 * Free tiers (checked 2026-11-04): Steel stealthConfig yes, solveCaptcha needs a paid balance; Hyperbrowser useStealth yes,
 * solveCaptchas paid only; Browserless stealth flag accepted (its shared IPs still get Cloudflare's block page);
 * Anchor captcha solving needs its paid proxy. Paid captcha solving switches on with STEEL_SOLVE_CAPTCHA=1,
 * HYPERBROWSER_SOLVE_CAPTCHAS=1, BROWSERLESS_SOLVE_CAPTCHAS=1 or ANCHOR_SOLVE_CAPTCHA=1.
 */
export const STEALTH_ORDER: ProviderId[] = ["steel", "browserless", "hyperbrowser", "anchor", "browserbase"];
const on = (v: string | undefined) => v === "1" || v === "true";

const DEFAULT_ORDER: ProviderId[] = ["steel", "browserless", "browserbase", "hyperbrowser", "anchor"];
const noop = async () => {};

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`HTTP ${r.status} ${String(j.message ?? j.error ?? "").slice(0, 120)}`);
  return j;
}

export function configuredProviders(env: Env = process.env): ProviderId[] {
  const order = (env.BROWSER_PROVIDERS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) as ProviderId[] | undefined) ?? DEFAULT_ORDER;
  const has: Record<ProviderId, boolean> = {
    steel: !!env.STEEL_API_KEY,
    browserless: !!env.BROWSERLESS_TOKEN,
    browserbase: !!env.BROWSERBASE_API_KEY && !!env.BROWSERBASE_PROJECT_ID,
    hyperbrowser: !!env.HYPERBROWSER_API_KEY,
    anchor: !!env.ANCHOR_API_KEY,
  };
  return order.filter((p) => DEFAULT_ORDER.includes(p) && has[p]);
}

/** Start a cloud browser session on one provider and return its CDP WebSocket URL. */
export async function startSession(p: ProviderId, env: Env = process.env, opts: SessionOpts = {}): Promise<CdpSession> {
  if (opts.stealth) return { ...(await startStealthSession(p, env)), stealth: true };
  switch (p) {
    case "steel": {
      // A session made through the API has a live view (debugUrl) and survives a dropped connection; the bare connect
      // URL is the fallback when the API refuses.
      const key = env.STEEL_API_KEY!;
      try {
        const j = await postJson("https://api.steel.dev/v1/sessions", { "steel-api-key": key }, { timeout: 900000 });
        const id = String(j.id ?? "");
        if (!id) throw new Error("no session id");
        return { provider: p, id, live: liveViewFrom(p, j), wsUrl: String(j.websocketUrl || `wss://connect.steel.dev?apiKey=${encodeURIComponent(key)}&sessionId=${id}`), release: steelRelease(key, id) };
      } catch {
        return { provider: p, wsUrl: `wss://connect.steel.dev?apiKey=${encodeURIComponent(key)}`, release: noop };
      }
    }
    case "browserless": {
      const host = env.BROWSERLESS_HOST || "production-sfo.browserless.io";
      return { provider: p, wsUrl: `wss://${host}?token=${encodeURIComponent(env.BROWSERLESS_TOKEN!)}`, release: noop };
    }
    case "browserbase": {
      const key = env.BROWSERBASE_API_KEY!;
      const j = await postJson("https://api.browserbase.com/v1/sessions", { "X-BB-API-Key": key }, { projectId: env.BROWSERBASE_PROJECT_ID });
      const id = String(j.id ?? "");
      const release = async () => {
        await fetch(`https://api.browserbase.com/v1/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-BB-API-Key": key }, body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID, status: "REQUEST_RELEASE" }) }).catch(() => {});
      };
      return { provider: p, id, live: await browserbaseLive(key, id), wsUrl: String(j.connectUrl), release };
    }
    case "hyperbrowser": {
      const key = env.HYPERBROWSER_API_KEY!;
      const j = await postJson("https://api.hyperbrowser.ai/api/session", { "x-api-key": key }, {});
      const id = String(j.id ?? "");
      return { provider: p, id, live: liveViewFrom(p, j), wsUrl: String(j.wsEndpoint), release: hyperRelease(key, id) };
    }
    case "anchor": {
      const key = env.ANCHOR_API_KEY!;
      const j = await postJson("https://api.anchorbrowser.io/v1/sessions", { "anchor-api-key": key }, {});
      const d = (j.data ?? j) as Record<string, unknown>;
      const id = String(d.id ?? "");
      return { provider: p, id, live: liveViewFrom(p, d), wsUrl: String(d.cdp_url ?? `wss://connect.anchorbrowser.io?apiKey=${encodeURIComponent(key)}&sessionId=${id}`), release: anchorRelease(key, id) };
    }
  }
}

/** A session in the provider's stealth mode (and its captcha solver when the owner has turned on a paid one). */
async function startStealthSession(p: ProviderId, env: Env): Promise<CdpSession> {
  switch (p) {
    case "steel": {
      const key = env.STEEL_API_KEY!;
      const j = await postJson("https://api.steel.dev/v1/sessions", { "steel-api-key": key }, {
        stealthConfig: { humanizeInteractions: true }, timeout: 300000, ...(on(env.STEEL_SOLVE_CAPTCHA) ? { solveCaptcha: true } : {}),
      });
      const id = String(j.id ?? "");
      return { provider: p, id, live: liveViewFrom(p, j), wsUrl: String(j.websocketUrl || `wss://connect.steel.dev?apiKey=${encodeURIComponent(key)}&sessionId=${id}`), release: steelRelease(key, id) };
    }
    case "browserless": {
      const host = env.BROWSERLESS_HOST || "production-sfo.browserless.io";
      return { provider: p, wsUrl: `wss://${host}?token=${encodeURIComponent(env.BROWSERLESS_TOKEN!)}&stealth=true${on(env.BROWSERLESS_SOLVE_CAPTCHAS) ? "&solveCaptchas=true" : ""}`, release: noop };
    }
    case "hyperbrowser": {
      const key = env.HYPERBROWSER_API_KEY!;
      const j = await postJson("https://api.hyperbrowser.ai/api/session", { "x-api-key": key }, { useStealth: true, ...(on(env.HYPERBROWSER_SOLVE_CAPTCHAS) ? { solveCaptchas: true } : {}) });
      const id = String(j.id ?? "");
      return { provider: p, id, live: liveViewFrom(p, j), wsUrl: String(j.wsEndpoint), release: hyperRelease(key, id) };
    }
    case "anchor": {
      const key = env.ANCHOR_API_KEY!;
      const captcha = on(env.ANCHOR_SOLVE_CAPTCHA);
      const j = await postJson("https://api.anchorbrowser.io/v1/sessions", { "anchor-api-key": key }, {
        browser: { extra_stealth: { active: true }, ...(captcha ? { captcha_solver: { active: true } } : {}) },
        ...(captcha ? { session: { proxy: { active: true, type: "anchor_proxy" } } } : {}),
      });
      const d = (j.data ?? j) as Record<string, unknown>;
      const id = String(d.id ?? "");
      return { provider: p, id, live: liveViewFrom(p, d), wsUrl: String(d.cdp_url ?? `wss://connect.anchorbrowser.io?apiKey=${encodeURIComponent(key)}&sessionId=${id}`), release: anchorRelease(key, id) };
    }
    case "browserbase":
      // Browserbase's basic stealth is always on; its captcha solving is on by default where the plan has it.
      return startSession(p, env);
  }
}

const steelRelease = (key: string, id: string) => async () => { await fetch(`https://api.steel.dev/v1/sessions/${id}/release`, { method: "POST", headers: { "steel-api-key": key } }).catch(() => {}); };
const hyperRelease = (key: string, id: string) => async () => { await fetch(`https://api.hyperbrowser.ai/api/session/${id}/stop`, { method: "PUT", headers: { "x-api-key": key } }).catch(() => {}); };
const anchorRelease = (key: string, id: string) => async () => { await fetch(`https://api.anchorbrowser.io/v1/sessions/${id}`, { method: "DELETE", headers: { "anchor-api-key": key } }).catch(() => {}); };

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return j;
}

async function browserbaseLive(key: string, id: string): Promise<LiveView | null> {
  try { return liveViewFrom("browserbase", await getJson(`https://api.browserbase.com/v1/sessions/${id}/debug`, { "X-BB-API-Key": key })); } catch { return null; }
}

/** Providers whose API sessions outlive our connection, so a paused job can continue in the next worker run. */
export const RESUMABLE: ProviderId[] = ["steel", "hyperbrowser", "anchor", "browserbase"];

/** Reconnect to a session a previous worker run left open (a paused job handed over at the end of its time budget). */
export async function resumeSession(p: ProviderId, id: string, env: Env = process.env): Promise<CdpSession> {
  if (!/^[A-Za-z0-9-]{6,80}$/.test(id) || !RESUMABLE.includes(p)) throw new Error("Can't resume this browser session");
  switch (p) {
    case "steel": {
      const key = env.STEEL_API_KEY!;
      const j = await getJson(`https://api.steel.dev/v1/sessions/${id}`, { "steel-api-key": key });
      if (j.status && j.status !== "live") throw new Error("The browser session has ended");
      return { provider: p, id, live: liveViewFrom(p, j), wsUrl: `wss://connect.steel.dev?apiKey=${encodeURIComponent(key)}&sessionId=${id}`, release: steelRelease(key, id) };
    }
    case "hyperbrowser": {
      const key = env.HYPERBROWSER_API_KEY!;
      const j = await getJson(`https://api.hyperbrowser.ai/api/session/${id}`, { "x-api-key": key });
      if (j.status && j.status !== "active") throw new Error("The browser session has ended");
      return { provider: p, id, live: liveViewFrom(p, j), wsUrl: String(j.wsEndpoint), release: hyperRelease(key, id) };
    }
    case "anchor": {
      const key = env.ANCHOR_API_KEY!;
      return { provider: p, id, live: null, wsUrl: `wss://connect.anchorbrowser.io?apiKey=${encodeURIComponent(key)}&sessionId=${id}`, release: anchorRelease(key, id) };
    }
    default: {
      const key = env.BROWSERBASE_API_KEY!;
      const j = await getJson(`https://api.browserbase.com/v1/sessions/${id}`, { "X-BB-API-Key": key });
      const release = async () => {
        await fetch(`https://api.browserbase.com/v1/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-BB-API-Key": key }, body: JSON.stringify({ projectId: env.BROWSERBASE_PROJECT_ID, status: "REQUEST_RELEASE" }) }).catch(() => {});
      };
      return { provider: p, id, live: await browserbaseLive(key, id), wsUrl: String(j.connectUrl), release };
    }
  }
}

/** Never put a provider key in a log line or error message. */
export function redact(s: string): string {
  return s.replace(/(apiKey|token|key)=[^&\s"']+/gi, "$1=***");
}
