import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/server/auth";
import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { needsRefresh, refreshCreds } from "@/lib/connectors/oauth";
import type { ConnectionInfo, ConnectionStatus, ConnectorDef, Credentials } from "@/lib/connectors/types";

/**
 * Server-only credential storage. Credentials are AES-256-GCM encrypted and written to
 * connections.encrypted_credentials, a column the anon/authenticated roles have no SELECT grant on
 * (migration 0007). Only this module, through the service-role client, reads or writes it.
 */

/** Columns safe to read with the user's own (RLS) client. Never includes encrypted_credentials. */
export const PUBLIC_COLS = "id, connector_id, status, scopes, account_label, created_at, last_used_at";

export class NotConnectedError extends Error {
  constructor(public connector: string, public status: ConnectionStatus | "missing" = "missing") {
    super(status === "expired" ? "connector_expired" : "connector_not_connected");
  }
}

/** The user's visible connection rows (RLS-scoped client). */
export async function listConnections(db: Db, userId: string): Promise<ConnectionInfo[]> {
  const { data, error } = await db.from("connections").select(PUBLIC_COLS).eq("user_id", userId);
  if (error) throw new Error("Could not load connections");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    connector_id: String(r.connector_id), status: (r.status as ConnectionStatus) ?? "connected",
    scopes: (r.scopes as string[]) ?? [], account_label: String(r.account_label ?? ""),
    created_at: r.created_at as string | undefined, last_used_at: (r.last_used_at as string | null) ?? null,
  }));
}

export async function saveConnection(userId: string, connectorId: string, p: { creds: Credentials; accountLabel: string; scopes: string[]; meta?: Record<string, unknown> }) {
  const admin = createAdminClient();
  const creds: Credentials = { ...p.creds, meta: { ...(p.creds.meta ?? {}), ...(p.meta ?? {}) } };
  const now = new Date().toISOString();
  const { data, error } = await admin.from("connections").upsert({
    user_id: userId, connector_id: connectorId, status: "connected",
    encrypted_credentials: encryptSecret(JSON.stringify(creds), primaryKey()),
    scopes: p.scopes.slice(0, 30), account_label: p.accountLabel.slice(0, 200),
    created_at: now, connected_at: now, last_used_at: null,
  }, { onConflict: "user_id,connector_id" }).select("id").single();
  if (error || !data) throw new Error("Could not save the connection");
  return data.id as string;
}

type Row = { id: string; status: ConnectionStatus; scopes: string[]; account_label: string; encrypted_credentials: string | null };

async function loadRow(userId: string, connectorId: string): Promise<Row | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("connections").select("id, status, scopes, account_label, encrypted_credentials")
    .eq("user_id", userId).eq("connector_id", connectorId).maybeSingle();
  if (!data) return null;
  const row = data as Row;
  if (!row.encrypted_credentials) {
    // Rows from migration 0006 that 0007 couldn't copy (shouldn't happen) still have their legacy secret.
    const { data: legacy } = await admin.from("connection_secrets").select("ciphertext").eq("connection_id", row.id).eq("user_id", userId).maybeSingle();
    row.encrypted_credentials = (legacy?.ciphertext as string | undefined) ?? null;
  }
  return row;
}

export async function setStatus(userId: string, connectorId: string, status: ConnectionStatus) {
  await createAdminClient().from("connections").update({ status }).eq("user_id", userId).eq("connector_id", connectorId);
}

/**
 * Valid credentials for one of the user's connections, refreshing OAuth tokens shortly before expiry.
 * If the refresh fails the connection is marked "expired" and NotConnectedError is thrown.
 */
export async function getCredentials(userId: string, c: ConnectorDef, f: typeof fetch = fetch): Promise<{ creds: Credentials; info: ConnectionInfo }> {
  const row = await loadRow(userId, c.id);
  if (!row || !row.encrypted_credentials) throw new NotConnectedError(c.id, "missing");
  if (row.status !== "connected") throw new NotConnectedError(c.id, row.status);
  let creds: Credentials;
  try { creds = JSON.parse(decryptWithAny(row.encrypted_credentials, decryptionKeys())) as Credentials; }
  catch { await setStatus(userId, c.id, "expired"); throw new NotConnectedError(c.id, "expired"); }
  if (needsRefresh(creds)) {
    try {
      creds = await refreshCreds(c, process.env, creds, f);
      await createAdminClient().from("connections")
        .update({ encrypted_credentials: encryptSecret(JSON.stringify(creds), primaryKey()) })
        .eq("id", row.id).eq("user_id", userId);
    } catch {
      await setStatus(userId, c.id, "expired");
      throw new NotConnectedError(c.id, "expired");
    }
  }
  return { creds, info: { connector_id: c.id, status: "connected", scopes: row.scopes ?? [], account_label: row.account_label ?? "", meta: creds.meta ?? {} } };
}

export async function touchLastUsed(userId: string, connectorId: string) {
  try { await createAdminClient().from("connections").update({ last_used_at: new Date().toISOString() }).eq("user_id", userId).eq("connector_id", connectorId); }
  catch { /* bookkeeping only */ }
}

/** Revoke at the provider (best effort), then delete the row (credentials go with it). */
export async function removeConnection(userId: string, c: ConnectorDef, f: typeof fetch = fetch): Promise<boolean> {
  const row = await loadRow(userId, c.id);
  if (!row) return false;
  if (row.encrypted_credentials) {
    try {
      const creds = JSON.parse(decryptWithAny(row.encrypted_credentials, decryptionKeys())) as Credentials;
      const revoke = c.oauth?.revoke ?? c.apiKey?.revoke;
      if (revoke) await revoke(creds, process.env, f);
    } catch { /* revocation is best effort; the local copy is still deleted */ }
  }
  await createAdminClient().from("connections").delete().eq("id", row.id).eq("user_id", userId);
  return true;
}
