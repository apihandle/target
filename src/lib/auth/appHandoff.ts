import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey, randomToken, sha256 } from "@/lib/connectors/crypto";
import { isValidCodeChallenge } from "@/lib/auth/googleLogin";
import { safeNext } from "@/lib/ids";

/**
 * One-time handoff of a Supabase session from Chrome back into the Android app's WebView.
 *
 * "Continue with Google" started from the app runs the OAuth flow in a Custom Tab (Chrome),
 * because Google blocks sign-in inside WebViews — so the session the callback creates belongs
 * to Chrome and can never reach the WebView. Instead, when the login cookie says `app`, the
 * callback stores the session (encrypted, service role only, table app_login_handoffs) behind
 * a random code and redirects Chrome to /auth/app-return?code=…, an Android App Link that
 * reopens the app. The app loads /auth/app-handoff?code=… in its WebView, which consumes the
 * code exactly once and calls supabase.auth.setSession(), so the session cookies land in the
 * WebView. Only the SHA-256 hash of the code is stored; codes expire after 60 seconds and are
 * deleted when consumed, so each code can be used once.
 *
 * Fix #4 — the code alone used to be a bearer token: any browser that opened the handoff URL
 * within the TTL got the session (login CSRF / code interception). The handoff is now bound to
 * the app instance that started sign-in, PKCE-style (RFC 7636): before opening the Custom Tab
 * the app generates a random verifier that never leaves the phone and sends only
 * code_challenge = base64url(SHA-256(verifier)) with /auth/google. The challenge travels in
 * the login cookie and the callback stores it on the handoff row (column code_challenge,
 * migration 0022); /auth/app-handoff releases the session only when the caller presents the
 * matching verifier. Backward compatibility: rows with no challenge (older app versions, or a
 * sign-in started without code_challenge) keep the old code-only behaviour, so an old app
 * build in the field still signs in — the binding protects every sign-in started by a new
 * build. A failed verifier check does NOT consume the code (the real app can still claim it
 * within the TTL); only a successful claim — or expiry — deletes the row.
 */
export const HANDOFF_TTL_MS = 60 * 1000;

export type HandoffSession = { access_token: string; refresh_token: string };
export type HandoffRow = { session_enc: string; next: string | null; expires_at: string; code_challenge: string | null };

/** Storage seam, injected in tests (same pattern as exchangeLoginCode's fetch parameter). */
export interface HandoffStore {
  insert(row: { code_hash: string; session_enc: string; next: string; expires_at: string; code_challenge: string | null }): Promise<void>;
  /** Delete the row for a code hash and return it, so a code can only ever be taken once. */
  take(codeHash: string): Promise<HandoffRow | null>;
  /** Read the row for a code hash WITHOUT consuming it, so a failed verifier check leaves the code claimable. */
  peek(codeHash: string): Promise<HandoffRow | null>;
}

const dbStore: HandoffStore = {
  async insert(row) {
    const { error } = await createAdminClient().from("app_login_handoffs").insert(row);
    if (error) throw new Error("Could not create the app handoff");
  },
  async take(codeHash) {
    const { data } = await createAdminClient().from("app_login_handoffs").delete().eq("code_hash", codeHash).select("session_enc, next, expires_at, code_challenge");
    const row = (data as HandoffRow[] | null)?.[0];
    return row ?? null;
  },
  async peek(codeHash) {
    const { data } = await createAdminClient().from("app_login_handoffs").select("session_enc, next, expires_at, code_challenge").eq("code_hash", codeHash).limit(1);
    const row = (data as HandoffRow[] | null)?.[0];
    return row ?? null;
  },
};

/** Constant-time check that a presented verifier hashes to the stored challenge. */
export function verifierMatchesChallenge(verifier: string, challenge: string): boolean {
  const a = Buffer.from(sha256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createAppHandoff(session: HandoffSession, next: string, store: HandoffStore = dbStore, now: number = Date.now(), challenge: string | null = null): Promise<string> {
  const code = randomToken(32);
  await store.insert({
    code_hash: sha256(code),
    session_enc: encryptSecret(JSON.stringify(session), primaryKey()),
    next: safeNext(next),
    expires_at: new Date(now + HANDOFF_TTL_MS).toISOString(),
    // Only a well-formed challenge binds the handoff; anything else stores the legacy unbound row.
    code_challenge: isValidCodeChallenge(challenge) ? challenge : null,
  });
  return code;
}

/**
 * Consume a handoff code exactly once. Returns null if unknown, expired, used, or corrupt.
 * When the row carries a challenge (fix #4), the caller must also present the matching
 * `verifier`; a missing/wrong verifier returns null but does NOT consume the code, so the
 * app that started sign-in can still claim it before the TTL runs out.
 */
export async function consumeAppHandoff(code: string, store: HandoffStore = dbStore, now: number = Date.now(), verifier: string | null = null): Promise<{ session: HandoffSession; next: string } | null> {
  if (!code || code.length > 200) return null;
  const codeHash = sha256(code);
  const peeked = await store.peek(codeHash);
  if (!peeked) return null;
  if (Date.parse(peeked.expires_at) < now) {
    // Expired: sweep the row so it cannot linger, same net effect as the old take-first flow.
    await store.take(codeHash).catch(() => null);
    return null;
  }
  if (peeked.code_challenge) {
    if (!verifier || verifier.length > 200 || !verifierMatchesChallenge(verifier, peeked.code_challenge)) return null;
  }
  const row = await store.take(codeHash);
  if (!row) return null; // lost a race: another caller consumed it first
  if (Date.parse(row.expires_at) < now) return null;
  try {
    const s = JSON.parse(decryptWithAny(row.session_enc, decryptionKeys())) as Partial<HandoffSession>;
    if (typeof s?.access_token !== "string" || typeof s?.refresh_token !== "string") return null;
    return { session: { access_token: s.access_token, refresh_token: s.refresh_token }, next: safeNext(row.next) };
  } catch {
    return null;
  }
}
