import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey, randomToken, sha256 } from "@/lib/connectors/crypto";
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
 */
export const HANDOFF_TTL_MS = 60 * 1000;

export type HandoffSession = { access_token: string; refresh_token: string };
export type HandoffRow = { session_enc: string; next: string | null; expires_at: string };

/** Storage seam, injected in tests (same pattern as exchangeLoginCode's fetch parameter). */
export interface HandoffStore {
  insert(row: { code_hash: string; session_enc: string; next: string; expires_at: string }): Promise<void>;
  /** Delete the row for a code hash and return it, so a code can only ever be taken once. */
  take(codeHash: string): Promise<HandoffRow | null>;
}

const dbStore: HandoffStore = {
  async insert(row) {
    const { error } = await createAdminClient().from("app_login_handoffs").insert(row);
    if (error) throw new Error("Could not create the app handoff");
  },
  async take(codeHash) {
    const { data } = await createAdminClient().from("app_login_handoffs").delete().eq("code_hash", codeHash).select("session_enc, next, expires_at");
    const row = (data as HandoffRow[] | null)?.[0];
    return row ?? null;
  },
};

export async function createAppHandoff(session: HandoffSession, next: string, store: HandoffStore = dbStore, now: number = Date.now()): Promise<string> {
  const code = randomToken(32);
  await store.insert({
    code_hash: sha256(code),
    session_enc: encryptSecret(JSON.stringify(session), primaryKey()),
    next: safeNext(next),
    expires_at: new Date(now + HANDOFF_TTL_MS).toISOString(),
  });
  return code;
}

/** Consume a handoff code exactly once. Returns null if unknown, expired, used, or corrupt. */
export async function consumeAppHandoff(code: string, store: HandoffStore = dbStore, now: number = Date.now()): Promise<{ session: HandoffSession; next: string } | null> {
  if (!code || code.length > 200) return null;
  const row = await store.take(sha256(code));
  if (!row) return null;
  if (Date.parse(row.expires_at) < now) return null;
  try {
    const s = JSON.parse(decryptWithAny(row.session_enc, decryptionKeys())) as Partial<HandoffSession>;
    if (typeof s?.access_token !== "string" || typeof s?.refresh_token !== "string") return null;
    return { session: { access_token: s.access_token, refresh_token: s.refresh_token }, next: safeNext(row.next) };
  } catch {
    return null;
  }
}
