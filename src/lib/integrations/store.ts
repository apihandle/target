import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, loadKey } from "@/lib/integrations/crypto";
import { refreshTokens, revoke, type GoogleTokens } from "@/lib/integrations/google";

/**
 * Token storage for connected apps. Tokens are encrypted (AES-256-GCM, TOKEN_ENCRYPTION_KEY)
 * and written to `connection_secrets`, a table browsers cannot read (RLS on, no policies).
 * Only this server module, using the service-role key, touches it.
 */
export async function saveConnection(userId: string, provider: string, tokens: GoogleTokens, accountLabel: string, scopes: string[]) {
  const admin = createAdminClient();
  const key = loadKey(process.env.TOKEN_ENCRYPTION_KEY);
  const { data, error } = await admin.from("connections")
    .upsert({ user_id: userId, provider, account_label: accountLabel.slice(0, 200), scopes, connected_at: new Date().toISOString() }, { onConflict: "user_id,provider" })
    .select("id").single();
  if (error || !data) throw new Error("Could not save the connection");
  const { error: sErr } = await admin.from("connection_secrets")
    .upsert({ connection_id: data.id, user_id: userId, ciphertext: encryptSecret(JSON.stringify(tokens), key), updated_at: new Date().toISOString() });
  if (sErr) throw new Error("Could not store the connection securely");
}

/** Returns a valid access token, refreshing (and re-encrypting) when it has expired. */
export async function getAccessToken(userId: string, provider: string): Promise<string> {
  const admin = createAdminClient();
  const key = loadKey(process.env.TOKEN_ENCRYPTION_KEY);
  const { data: conn } = await admin.from("connections").select("id").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (!conn) throw new Error("This app isn't connected");
  const { data: sec } = await admin.from("connection_secrets").select("ciphertext").eq("connection_id", conn.id).eq("user_id", userId).maybeSingle();
  if (!sec) throw new Error("Connection is missing its credentials. Reconnect it in Settings.");
  let tokens = JSON.parse(decryptSecret(sec.ciphertext as string, key)) as GoogleTokens;
  if (tokens.expires_at - 60_000 < Date.now()) {
    tokens = await refreshTokens(process.env, tokens);
    await admin.from("connection_secrets").update({ ciphertext: encryptSecret(JSON.stringify(tokens), key), updated_at: new Date().toISOString() }).eq("connection_id", conn.id);
  }
  return tokens.access_token;
}

/** Revoke at the provider (best effort) and delete stored tokens + connection row. */
export async function removeConnection(userId: string, provider: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: conn } = await admin.from("connections").select("id").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (!conn) return false;
  try {
    const key = loadKey(process.env.TOKEN_ENCRYPTION_KEY);
    const { data: sec } = await admin.from("connection_secrets").select("ciphertext").eq("connection_id", conn.id).maybeSingle();
    if (sec) {
      const t = JSON.parse(decryptSecret(sec.ciphertext as string, key)) as GoogleTokens;
      await revoke(t.refresh_token ?? t.access_token);
    }
  } catch { /* still delete locally */ }
  await admin.from("connections").delete().eq("id", conn.id).eq("user_id", userId);
  return true;
}
