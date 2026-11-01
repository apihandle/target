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
type Env = Record<string, string | undefined>;

export type ProviderId = "steel" | "browserless" | "browserbase" | "hyperbrowser" | "anchor";
export interface CdpSession { provider: ProviderId; wsUrl: string; release: () => Promise<void> }

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
export async function startSession(p: ProviderId, env: Env = process.env): Promise<CdpSession> {
  switch (p) {
    case "steel":
      return { provider: p, wsUrl: `wss://connect.steel.dev?apiKey=${encodeURIComponent(env.STEEL_API_KEY!)}`, release: noop };
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
      return { provider: p, wsUrl: String(j.connectUrl), release };
    }
    case "hyperbrowser": {
      const key = env.HYPERBROWSER_API_KEY!;
      const j = await postJson("https://api.hyperbrowser.ai/api/session", { "x-api-key": key }, {});
      const id = String(j.id ?? "");
      const release = async () => { await fetch(`https://api.hyperbrowser.ai/api/session/${id}/stop`, { method: "PUT", headers: { "x-api-key": key } }).catch(() => {}); };
      return { provider: p, wsUrl: String(j.wsEndpoint), release };
    }
    case "anchor": {
      const key = env.ANCHOR_API_KEY!;
      const j = await postJson("https://api.anchorbrowser.io/v1/sessions", { "anchor-api-key": key }, {});
      const d = (j.data ?? j) as Record<string, unknown>;
      const id = String(d.id ?? "");
      const release = async () => { await fetch(`https://api.anchorbrowser.io/v1/sessions/${id}`, { method: "DELETE", headers: { "anchor-api-key": key } }).catch(() => {}); };
      return { provider: p, wsUrl: String(d.cdp_url ?? `wss://connect.anchorbrowser.io?apiKey=${encodeURIComponent(key)}&sessionId=${id}`), release };
    }
  }
}

/** Never put a provider key in a log line or error message. */
export function redact(s: string): string {
  return s.replace(/(apiKey|token|key)=[^&\s"']+/gi, "$1=***");
}
