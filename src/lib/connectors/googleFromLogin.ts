import { SCOPES, LEGACY_SCOPES } from "@/lib/connectors/google/shared";
import type { Credentials } from "@/lib/connectors/types";



type Info = { scope?: string; expires_in?: string | number; email?: string; error_description?: string };

/**
 * Turn the Google tokens Supabase hands back after a Google sign-in into a TARGET Google connection.
 * Asks Google which scopes were really granted (the user can untick some), so only those tools show.
 * Returns null when the sign-in granted no Gmail/Calendar/Drive scope.
 */
export async function connectionFromLogin(
  tokens: { provider_token?: string | null; provider_refresh_token?: string | null },
  f: typeof fetch = fetch,
): Promise<{ creds: Credentials; accountLabel: string; scopes: string[] } | null> {
  const access = tokens.provider_token;
  if (!access) return null;
  const r = await f(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access)}`);
  if (!r.ok) return null;
  const info = (await r.json()) as Info;
  const scopes = String(info.scope ?? "").split(/\s+/).filter(Boolean);
  const useful = [...Object.values(SCOPES), ...Object.values(LEGACY_SCOPES)];
  if (!scopes.some((s) => useful.includes(s))) return null;
  const ttl = Number(info.expires_in ?? 3500);
  const creds: Credentials = {
    type: "oauth",
    access_token: access,
    ...(tokens.provider_refresh_token ? { refresh_token: tokens.provider_refresh_token } : {}),
    expires_at: Date.now() + Math.max(60, ttl) * 1000,
    scope: scopes.join(" "),
  };
  return { creds, accountLabel: String(info.email ?? ""), scopes };
}
