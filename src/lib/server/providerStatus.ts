import type { Db } from "@/lib/server/auth";
import type { ProviderId } from "@/lib/server/remoteBrowser";

/** Cloud browsers the admin page reports on, with the env var that holds each key. */
export const PROVIDER_KEYS: { id: ProviderId; name: string; env: string[] }[] = [
  { id: "steel", name: "Steel", env: ["STEEL_API_KEY"] },
  { id: "browserless", name: "Browserless", env: ["BROWSERLESS_TOKEN"] },
  { id: "hyperbrowser", name: "Hyperbrowser", env: ["HYPERBROWSER_API_KEY"] },
  { id: "anchor", name: "Anchor", env: ["ANCHOR_API_KEY"] },
  { id: "browserbase", name: "Browserbase", env: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
];

/** Out of credit / over a plan limit, as opposed to a plain outage. */
export const LIMIT_ERROR = /\b(402|429)\b|credit|quota|limit|exceeded|insufficient|payment required|upgrade|too many (concurrent|sessions)/i;

export type ProviderState = { id: ProviderId; name: string; keyPresent: boolean; lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null; limit: boolean };

/**
 * Remember the latest start of a cloud browser: admin_settings "provider_ok:<id>" / "provider_err:<id>". Never throws,
 * never waits for long, and does nothing where the service role isn't configured (an external worker).
 */
export async function recordProviderResult(p: ProviderId, ok: boolean, error?: string): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient() as unknown as Db;
    const now = new Date().toISOString();
    const row: { key: string; value: Record<string, unknown>; updated_at: string } = ok
      ? { key: `provider_ok:${p}`, value: { at: now }, updated_at: now }
      : { key: `provider_err:${p}`, value: { at: now, message: (error ?? "").slice(0, 200), limit: LIMIT_ERROR.test(error ?? "") }, updated_at: now };
    await Promise.race([db.from("admin_settings").upsert(row, { onConflict: "key" }), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* status is best effort */ }
}

export async function loadProviderStates(db: Db, env: Record<string, string | undefined> = process.env): Promise<ProviderState[]> {
  let rows: { key: string; value: Record<string, unknown> }[] = [];
  try {
    const { data } = await db.from("admin_settings").select("key, value").in("key", PROVIDER_KEYS.flatMap((p) => [`provider_ok:${p.id}`, `provider_err:${p.id}`]));
    rows = (data ?? []) as typeof rows;
  } catch { /* table missing: keys only */ }
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return PROVIDER_KEYS.map(({ id, name, env: keys }) => {
    const ok = get(`provider_ok:${id}`);
    const err = get(`provider_err:${id}`);
    const lastOkAt = typeof ok?.at === "string" ? ok.at : null;
    const lastErrorAt = typeof err?.at === "string" ? err.at : null;
    const fresh = !!lastErrorAt && (!lastOkAt || lastErrorAt > lastOkAt);
    return {
      id, name, keyPresent: keys.every((k) => !!env[k]), lastOkAt, lastErrorAt,
      lastError: typeof err?.message === "string" ? err.message : null, limit: fresh && !!err?.limit,
    };
  });
}

export type Capability = { name: string; works: boolean; reason: string };
const on = (v: string | undefined) => v === "1" || v === "true";

/**
 * What the browser can and can't do right now, each with a one-line reason. Measured facts are dated; flags and keys
 * are read live from the env (only whether they are set, never their values).
 */
export function capabilities(env: Record<string, string | undefined> = process.env): Capability[] {
  const live = !!env.STEEL_API_KEY || !!env.HYPERBROWSER_API_KEY;
  const paidOn = [on(env.STEEL_SOLVE_CAPTCHA) && "Steel", on(env.HYPERBROWSER_SOLVE_CAPTCHAS) && "Hyperbrowser", on(env.BROWSERLESS_SOLVE_CAPTCHAS) && "Browserless", on(env.ANCHOR_SOLVE_CAPTCHA) && "Anchor", env.CAPSOLVER_API_KEY && "CapSolver"].filter(Boolean) as string[];
  return [
    { name: "Live view + Take control", works: live, reason: live ? "Steel and Hyperbrowser sessions give an interactive live view, so a job pauses instead of failing." : "Needs STEEL_API_KEY or HYPERBROWSER_API_KEY." },
    { name: "Turnstile auto-solve (free checkbox click)", works: true, reason: "Easy checks only. Measured 2026-11-05: peet.ws managed demo 5/5; timebucks.com 0/7 and scrapingcourse.com 0/5 (Cloudflare rejects the cloud browser: 'Verification failed' / 'security check could not load')." },
    { name: "Turnstile solver service (self-hosted, free)", works: !!env.CF_SOLVER_URL, reason: env.CF_SOLVER_URL ? "CF_SOLVER_URL is set." : "Not available: no free host. Hugging Face Docker and Gradio Spaces need PRO; Koyeb needs a card; Render free (0.1 CPU, 512 MB, sleeps) is untested." },
    { name: "Paid captcha solver", works: paidOn.length > 0, reason: paidOn.length ? `On: ${paidOn.join(", ")}.` : "Not available: off. Cheapest: CapSolver $1.20 / 1000 Turnstile (CAPSOLVER_API_KEY); 2Captcha $1.45 / 1000; Steel $3 / 1000 needs a paid balance (STEEL_SOLVE_CAPTCHA=1)." },
    { name: "Google sign-in by the bot", works: false, reason: "Not available: Google blocks automated browsers. The job pauses so the user signs in with Google via Take control." },
    { name: "Saved sign-ins (skip login next time)", works: true, reason: "Saved only after the server verifies the sign-in on the page; later jobs reuse the cookies." },
    { name: "Earn tasks (paid-to-click, ads, surveys)", works: false, reason: "Not available by design: a bot doing them is click fraud and gets the account banned. Sign-in and balance reading work." },
  ];
}
