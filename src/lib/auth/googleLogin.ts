import { randomBytes, createHash } from "crypto";
import { LOGIN_SCOPES } from "@/lib/connectors/googleLoginScopes";

/**
 * "Continue with Google" runs on TARGET's own domain (not Supabase's), so Google shows
 * gettarget.vercel.app on its screens. We do the OAuth code flow ourselves, then hand the
 * Google ID token to Supabase (signInWithIdToken) to create the session.
 * The redirect URI is the Google connector callback, already registered in Google Cloud;
 * a state starting with "login." tells that callback this is a sign-in.
 */
export const LOGIN_COOKIE = "tg_glogin";
export const LOGIN_PREFIX = "login.";

export type LoginCookie = { state: string; nonce: string; next: string; app?: boolean; challenge?: string };

/** A PKCE code_challenge (RFC 7636, S256): base64url(SHA-256(verifier)) — always exactly 43 chars, no padding. */
export const isValidCodeChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

export function newLogin(next: string, app = false, challenge?: string): { cookie: LoginCookie; hashedNonce: string } {
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  // The challenge only matters for app sign-ins (it binds the handoff code the callback parks);
  // callers must validate it with isValidCodeChallenge first — an invalid one is dropped here too.
  return { cookie: { state, nonce, next, ...(app ? { app: true } : {}), ...(app && isValidCodeChallenge(challenge) ? { challenge } : {}) }, hashedNonce: createHash("sha256").update(nonce).digest("hex") };
}

export function loginRedirectUri(origin: string) {
  return `${origin}/api/connectors/google/callback`;
}

export function loginAuthorizeUrl(env: Record<string, string | undefined>, origin: string, state: string, hashedNonce: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", loginRedirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", `openid email profile ${LOGIN_SCOPES}`);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", LOGIN_PREFIX + state);
  u.searchParams.set("nonce", hashedNonce);
  return u.toString();
}

export function parseLoginCookie(v: string | undefined): LoginCookie | null {
  if (!v) return null;
  try {
    const o = JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
    if (typeof o?.state === "string" && typeof o?.nonce === "string" && typeof o?.next === "string" && (o?.app === undefined || typeof o?.app === "boolean") && (o?.challenge === undefined || isValidCodeChallenge(o?.challenge))) return o;
  } catch { /* bad cookie */ }
  return null;
}
export const encodeLoginCookie = (c: LoginCookie) => Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

export type GoogleTokens = { id_token: string; access_token: string; refresh_token?: string };

export async function exchangeLoginCode(env: Record<string, string | undefined>, origin: string, code: string, f: typeof fetch = fetch): Promise<GoogleTokens> {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, grant_type: "authorization_code", redirect_uri: loginRedirectUri(origin),
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    }),
  });
  const j = (await r.json().catch(() => ({}))) as Partial<GoogleTokens> & { error?: string };
  if (!r.ok || !j.id_token || !j.access_token) throw new Error(`google token exchange failed: ${j.error ?? r.status}`);
  return { id_token: j.id_token, access_token: j.access_token, refresh_token: j.refresh_token };
}

