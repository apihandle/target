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
