import type { Db } from "@/lib/server/auth";
import { configuredProviders } from "@/lib/server/remoteBrowser";
import { loadCronStatus } from "@/lib/server/adminData";

/**
 * /admin → System health. Live checks use read-only, free endpoints with a 6 s timeout. Secrets are only ever
 * sent to their own provider in a header and never returned: env vars are reported as "set" / "missing" only.
 */
type Env = Record<string, string | undefined>;
export type CheckState = "ok" | "down" | "not_configured" | "unknown";
export type Check = { id: string; name: string; state: CheckState; detail: string; ms?: number };

/** Env vars shown on the health page (value never read beyond "is it non-empty"). */
export const ENV_GROUPS: { group: string; vars: string[] }[] = [
  { group: "Supabase", vars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
  { group: "Admin", vars: ["ADMIN_EMAILS", "ADMIN_EMAIL"] },
  { group: "AI", vars: ["NVIDIA_API_KEY", "NVIDIA_MODELS", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "VISION_MODELS"] },
  { group: "Search", vars: ["TAVILY_API_KEY"] },
  { group: "Encryption", vars: ["CONNECTOR_ENCRYPTION_KEY", "TOKEN_ENCRYPTION_KEY"] },
  { group: "Browser", vars: ["STEEL_API_KEY", "BROWSERLESS_TOKEN", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "HYPERBROWSER_API_KEY", "ANCHOR_API_KEY", "SESSION_WORKER_SECRET"] },
  { group: "Workers & cron", vars: ["COMPUTE_WORKER_SECRET", "CRON_SECRET"] },
  { group: "Connectors", vars: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SUPABASE_OAUTH_CLIENT_ID", "SUPABASE_OAUTH_CLIENT_SECRET", "CANVA_OAUTH_CLIENT_ID", "CANVA_OAUTH_CLIENT_SECRET", "SLACK_OAUTH_CLIENT_ID", "SLACK_OAUTH_CLIENT_SECRET", "NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"] },
  { group: "Phone alerts", vars: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] },
  { group: "Other", vars: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "POLLINATIONS_KEY"] },
];

export function envStatus(env: Env = process.env): { group: string; vars: { name: string; set: boolean }[] }[] {
  return ENV_GROUPS.map((g) => ({ group: g.group, vars: g.vars.map((name) => ({ name, set: !!env[name]?.trim() })) }));
}

const TIMEOUT = 6000;

/** GET a URL and classify: 2xx ok, 401/403 bad key, anything else down. The body is never returned. */
async function probe(id: string, name: string, url: string, headers: Record<string, string>, f: typeof fetch): Promise<Check> {
  const t0 = Date.now();
  try {
    const r = await f(url, { headers, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
    const ms = Date.now() - t0;
    try { await r.body?.cancel(); } catch { /* ignore */ }
    if (r.ok) return { id, name, state: "ok", detail: `Reachable (HTTP ${r.status})`, ms };
    if (r.status === 401 || r.status === 403) return { id, name, state: "down", detail: `Key rejected (HTTP ${r.status})`, ms };
    return { id, name, state: "down", detail: `HTTP ${r.status}`, ms };
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    return { id, name, state: "down", detail: timeout ? "No answer in 6 s" : "Could not connect", ms: Date.now() - t0 };
  }
}

const notConfigured = (id: string, name: string, detail = "Not configured"): Check => ({ id, name, state: "not_configured", detail });

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export async function runHealthChecks(db: Db, env: Env = process.env, f: typeof fetch = fetch, now = Date.now()): Promise<{ checks: Check[]; checkedAt: string }> {
  const tasks: Promise<Check>[] = [];

  // Supabase: a real query with the service-role client.
  tasks.push((async () => {
    const t0 = Date.now();
    try {
      const { error } = await db.from("conversations").select("id", { count: "exact", head: true });
      return error ? { id: "supabase", name: "Supabase", state: "down" as const, detail: "Database query failed", ms: Date.now() - t0 } : { id: "supabase", name: "Supabase", state: "ok" as const, detail: "Database answers", ms: Date.now() - t0 };
    } catch { return { id: "supabase", name: "Supabase", state: "down" as const, detail: "Could not connect", ms: Date.now() - t0 }; }
  })());

  // AI providers.
  tasks.push(env.NVIDIA_API_KEY ? probe("nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1/models", { Authorization: `Bearer ${env.NVIDIA_API_KEY}` }, f) : Promise.resolve(notConfigured("nim", "NVIDIA NIM")));
  tasks.push(env.OPENROUTER_API_KEY ? probe("openrouter", "OpenRouter", "https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, f) : Promise.resolve(notConfigured("openrouter", "OpenRouter")));
  // Custom providers belong to users (their own keys); the admin panel never decrypts them, so they're counted, not called.
  tasks.push((async () => {
    try {
      const { count, error } = await db.from("custom_providers").select("id", { count: "exact", head: true });
      if (error) return { id: "custom", name: "Custom AI providers", state: "unknown" as const, detail: "Table not readable (migration 0016?)" };
      return { id: "custom", name: "Custom AI providers", state: (count ? "ok" : "not_configured") as CheckState, detail: `${count ?? 0} saved by users. Not called from here: they use the users' own keys.` };
    } catch { return { id: "custom", name: "Custom AI providers", state: "unknown" as const, detail: "Could not count" }; }
  })());

  // Web search.
  tasks.push(env.TAVILY_API_KEY ? probe("tavily", "Tavily search", "https://api.tavily.com/usage", { Authorization: `Bearer ${env.TAVILY_API_KEY}` }, f) : Promise.resolve(notConfigured("tavily", "Tavily search")));

  // Cloud browsers (whichever are configured, in the worker's order).
  const browsers = configuredProviders(env);
  if (!browsers.length) tasks.push(Promise.resolve(notConfigured("browser", "Cloud browser", "No cloud browser key set (Steel, Browserless, Browserbase, Hyperbrowser or Anchor)")));
  for (const p of browsers) {
    if (p === "steel") tasks.push(probe("steel", "Steel", "https://api.steel.dev/v1/sessions", { "steel-api-key": env.STEEL_API_KEY! }, f));
    else if (p === "browserless") tasks.push(probe("browserless", "Browserless", `https://${env.BROWSERLESS_HOST || "production-sfo.browserless.io"}/json/version?token=${encodeURIComponent(env.BROWSERLESS_TOKEN!)}`, {}, f));
    else if (p === "browserbase") tasks.push(probe("browserbase", "Browserbase", `https://api.browserbase.com/v1/projects/${encodeURIComponent(env.BROWSERBASE_PROJECT_ID!)}`, { "X-BB-API-Key": env.BROWSERBASE_API_KEY! }, f));
    else if (p === "hyperbrowser") tasks.push(probe("hyperbrowser", "Hyperbrowser", "https://api.hyperbrowser.ai/api/sessions", { "x-api-key": env.HYPERBROWSER_API_KEY! }, f));
    else if (p === "anchor") tasks.push(Promise.resolve({ id: "anchor", name: "Anchor Browser", state: "unknown", detail: "Key set (no free status endpoint to call)" }));
  }

  // External workers have no URL of their own (they poll us), so their pulse is the last job they picked up.
  const lastClaim = async (modes: string[]) => {
    try {
      const { data } = await db.from("browser_jobs").select("claimed_at").in("mode", modes).not("claimed_at", "is", null).order("claimed_at", { ascending: false }).limit(1);
      return ((data ?? []) as { claimed_at: string }[])[0]?.claimed_at ?? null;
    } catch { return null; }
  };
  tasks.push((async () => {
    if (!env.SESSION_WORKER_SECRET) return notConfigured("worker", "Browser worker (HF / built-in)", "SESSION_WORKER_SECRET missing: no worker can pick up jobs");
    const at = await lastClaim(["steps", "auto"]);
    return { id: "worker", name: "Browser worker (HF / built-in)", state: at ? "ok" : "unknown", detail: `Last picked up a browser job ${ago(at, now)}` };
  })());
  tasks.push((async () => {
    if (!env.COMPUTE_WORKER_SECRET) return notConfigured("compute", "Compute worker", "Off (COMPUTE_WORKER_SECRET not set; code/video jobs go to the browser worker)");
    const at = await lastClaim(["code", "video"]);
    return { id: "compute", name: "Compute worker", state: at ? "ok" : "unknown", detail: `Last picked up a code/video job ${ago(at, now)}` };
  })());

  // Cron.
  tasks.push((async () => {
    if (!env.CRON_SECRET) return notConfigured("cron", "Cron", "CRON_SECRET missing: cron routes are closed");
    const c = await loadCronStatus(db);
    const last = c.scheduled?.at ?? c.lastJobRun;
    const stale = !last || now - Date.parse(last) > 6 * 3600000;
    const parts = [`Scheduled: ${ago(c.scheduled?.at ?? null, now)}${c.scheduled?.disabled ? " (paused by kill-switch)" : ""}`, `For-you scan: ${ago(c.proactive?.at ?? null, now)}`];
    if (!c.scheduled && c.lastJobRun) parts.push(`last scheduled prompt ran ${ago(c.lastJobRun, now)}`);
    return { id: "cron", name: "Cron", state: stale ? "unknown" : "ok", detail: parts.join(" · ") + (stale ? " (no run in 6 h)" : "") };
  })());

  return { checks: await Promise.all(tasks), checkedAt: new Date(now).toISOString() };
}
