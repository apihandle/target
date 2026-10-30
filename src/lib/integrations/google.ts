import type { Env } from "@/lib/integrations/registry";

/** Google Calendar adapter (OAuth 2.0 web-server flow, official REST API). Server only. */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export type GoogleTokens = { access_token: string; refresh_token?: string; expires_at: number; scope?: string };

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code",
    scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(env: Env, params: Record<string, string>, f: typeof fetch) {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", ...params }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof j.access_token !== "string") throw new Error(`Google token request failed (${r.status})`);
  return j;
}

export async function exchangeCode(env: Env, code: string, redirectUri: string, f: typeof fetch = fetch): Promise<{ tokens: GoogleTokens; email: string }> {
  const j = await tokenRequest(env, { code, redirect_uri: redirectUri, grant_type: "authorization_code" }, f);
  let email = "";
  if (typeof j.id_token === "string") {
    try { email = String(JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email ?? ""); } catch { /* label is cosmetic */ }
  }
  return {
    tokens: { access_token: j.access_token as string, refresh_token: j.refresh_token as string | undefined, expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000, scope: j.scope as string | undefined },
    email,
  };
}

export async function refreshTokens(env: Env, t: GoogleTokens, f: typeof fetch = fetch): Promise<GoogleTokens> {
  if (!t.refresh_token) throw new Error("Google connection expired. Reconnect it in Settings.");
  const j = await tokenRequest(env, { refresh_token: t.refresh_token, grant_type: "refresh_token" }, f);
  return { ...t, access_token: j.access_token as string, expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
}

export async function revoke(token: string, f: typeof fetch = fetch): Promise<void> {
  await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

export async function createEvent(accessToken: string, p: { title: string; start: string; end: string; location?: string; details?: string }, f: typeof fetch = fetch) {
  const r = await f("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: p.title, location: p.location || undefined, description: p.details || undefined,
      start: { dateTime: p.start }, end: { dateTime: p.end },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; htmlLink?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new Error(`Google Calendar refused the event${j.error?.message ? `: ${j.error.message}` : ` (${r.status})`}`);
  return { eventId: j.id, link: j.htmlLink ?? "" };
}
