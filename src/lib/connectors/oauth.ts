import type { ConnectorDef, Credentials, Env, OAuthConfig, TokenResult } from "@/lib/connectors/types";
import { ConnectorError } from "@/lib/connectors/http";

/** Generic OAuth 2.0 authorization-code flow (with optional PKCE) shared by every oauth connector. */

export function oauthConfigured(c: ConnectorDef, env: Env): boolean {
  return !!c.oauth && !!env[c.oauth.clientIdEnv] && !!env[c.oauth.clientSecretEnv];
}

export function authorizeUrl(c: ConnectorDef, env: Env, p: { redirectUri: string; state: string; codeChallenge?: string }): string {
  const o = c.oauth!;
  if (o.buildAuthorizeUrl) return o.buildAuthorizeUrl(env, p);
  const q = new URLSearchParams({
    client_id: env[o.clientIdEnv] ?? "",
    redirect_uri: p.redirectUri,
    response_type: "code",
    state: p.state,
    ...(c.scopes.length && !o.omitScope ? { [o.scopeParam ?? "scope"]: c.scopes.join(o.scopeSeparator ?? " ") } : {}),
    ...(o.pkce && p.codeChallenge ? { code_challenge: p.codeChallenge, code_challenge_method: "S256" } : {}),
    ...(o.extraAuthorizeParams ?? {}),
  });
  return `${o.authorizeUrl}?${q}`;
}

async function tokenRequest(o: OAuthConfig, env: Env, params: Record<string, string>, f: typeof fetch): Promise<Record<string, unknown>> {
  const id = env[o.clientIdEnv] ?? "", secret = env[o.clientSecretEnv] ?? "";
  const headers: Record<string, string> = { Accept: "application/json" };
  const body: Record<string, string> = { ...params };
  if (o.tokenAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else { body.client_id = id; body.client_secret = secret; }
  let payload: string;
  if (o.tokenBody === "json") { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  else { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(body).toString(); }
  let r: Response;
  try { r = await f(o.tokenUrl, { method: "POST", headers, body: payload }); }
  catch { throw new ConnectorError("The provider's token endpoint didn't respond", 504); }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  // Slack answers 200 with ok:false on errors.
  if (!r.ok || j.ok === false || j.error) throw new ConnectorError(`Token request failed (${r.status}${typeof j.error === "string" ? `: ${j.error}` : ""})`, r.ok ? 400 : r.status, "auth");
  return j;
}

function toCreds(o: OAuthConfig, j: Record<string, unknown>, prev?: Credentials): Credentials {
  const parsed = o.parseToken ? o.parseToken(j) : {};
  const access = (parsed.access_token ?? j.access_token) as string | undefined;
  if (!access || typeof access !== "string") throw new ConnectorError("The provider didn't return an access token", 502, "auth");
  const expiresIn = Number(parsed.expires_at ? NaN : j.expires_in);
  return {
    type: "oauth",
    access_token: access,
    refresh_token: (parsed.refresh_token ?? (j.refresh_token as string | undefined)) ?? prev?.refresh_token,
    expires_at: parsed.expires_at ?? (Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined),
    scope: (parsed.scope ?? (j.scope as string | undefined)) ?? prev?.scope,
    meta: parsed.meta || prev?.meta ? { ...(prev?.meta ?? {}), ...(parsed.meta ?? {}) } : undefined,
  };
}

export async function exchangeCode(c: ConnectorDef, env: Env, p: { code: string; redirectUri: string; codeVerifier?: string }, f: typeof fetch = fetch): Promise<TokenResult> {
  const o = c.oauth!;
  const j = await tokenRequest(o, env, {
    grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri,
    ...(o.pkce && p.codeVerifier ? { code_verifier: p.codeVerifier } : {}),
  }, f);
  const creds = toCreds(o, j);
  const granted = (creds.scope ?? c.scopes.join(" ")).split(/[\s,]+/).filter(Boolean);
  let accountLabel = "";
  if (o.accountLabel) { try { accountLabel = await o.accountLabel(creds.access_token, j, f); } catch { /* label is cosmetic */ } }
  return { creds, accountLabel: (accountLabel || `${c.name} account`).slice(0, 200), scopes: granted.slice(0, 30) };
}

export async function refreshCreds(c: ConnectorDef, env: Env, creds: Credentials, f: typeof fetch = fetch): Promise<Credentials> {
  const o = c.oauth;
  if (!o || !o.refreshable || !creds.refresh_token) throw new ConnectorError(`${c.name} access expired. Reconnect it.`, 401, "auth");
  const j = await tokenRequest(o, env, { grant_type: "refresh_token", refresh_token: creds.refresh_token }, f);
  return toCreds(o, j, creds);
}

/** Refresh when within this many ms of expiry. */
export const REFRESH_SKEW_MS = 120_000;
export const needsRefresh = (creds: Credentials, now = Date.now()) => !!creds.expires_at && creds.expires_at - REFRESH_SKEW_MS < now;
