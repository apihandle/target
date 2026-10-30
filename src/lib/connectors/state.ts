import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey, randomToken, sha256 } from "@/lib/connectors/crypto";

/**
 * OAuth `state` (CSRF protection). A random 32-byte value is sent to the provider; only its SHA-256
 * hash is stored server-side (table connector_oauth_states, service role only) together with the
 * user, connector, PKCE verifier (encrypted) and where to return. It expires after 10 minutes and is
 * deleted when consumed, so it can be used once.
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Only same-site app paths are allowed as return targets (no open redirects). */
export function safeReturnTo(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  if (!v.startsWith("/app") || v.startsWith("//") || v.includes("\\") || /[\r\n]/.test(v)) return null;
  return v;
}

export async function createState(p: { userId: string; connectorId: string; codeVerifier?: string; returnTo?: string | null }): Promise<string> {
  const state = randomToken(32);
  const { error } = await createAdminClient().from("connector_oauth_states").insert({
    state_hash: sha256(state), user_id: p.userId, connector_id: p.connectorId,
    code_verifier_enc: p.codeVerifier ? encryptSecret(p.codeVerifier, primaryKey()) : null,
    return_to: safeReturnTo(p.returnTo) ?? null,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error("Could not start the connection");
  return state;
}

/** Consume a state exactly once. Returns null if unknown, expired, used, or bound to another user/connector. */
export async function consumeState(state: string, userId: string, connectorId: string): Promise<{ codeVerifier?: string; returnTo: string | null } | null> {
  if (!state || state.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("connector_oauth_states").delete().eq("state_hash", sha256(state)).select("user_id, connector_id, code_verifier_enc, return_to, expires_at");
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;
  if (row.user_id !== userId || row.connector_id !== connectorId) return null;
  if (Date.parse(String(row.expires_at)) < Date.now()) return null;
  let codeVerifier: string | undefined;
  if (row.code_verifier_enc) { try { codeVerifier = decryptWithAny(String(row.code_verifier_enc), decryptionKeys()); } catch { return null; } }
  return { codeVerifier, returnTo: safeReturnTo(row.return_to) };
}
