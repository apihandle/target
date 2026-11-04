/**
 * Connector registry. Adding a connector = one file in src/lib/connectors/ + one line below.
 */
import type { ConnectionInfo, ConnectorDef, Env } from "@/lib/connectors/types";
import { hasEncryptionKey } from "@/lib/connectors/crypto";
import { oauthConfigured } from "@/lib/connectors/oauth";
import { supabase } from "@/lib/connectors/supabase";
import { vercel } from "@/lib/connectors/vercel";
import { github } from "@/lib/connectors/github";
import { google } from "@/lib/connectors/google";
import { figma } from "@/lib/connectors/figma";
import { canva } from "@/lib/connectors/canva";
import { slackConnector } from "@/lib/connectors/slack";
import { notion } from "@/lib/connectors/notion";

export const CONNECTORS: ConnectorDef[] = [
  supabase,
  vercel,
  github,
  google,
  figma,
  canva,
  slackConnector,
  notion,
];

const BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));
export const getConnector = (id: string): ConnectorDef | undefined => BY_ID.get(id);
export const CONNECTOR_ID = /^[a-z][a-z0-9_]{1,29}$/;

/** Server-wide prerequisites every connector needs (names only). */
export function missingEnv(c: ConnectorDef, env: Env): string[] {
  const out: string[] = [];
  if (!env.SUPABASE_SERVICE_ROLE_KEY) out.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!hasEncryptionKey(env)) out.push("CONNECTOR_ENCRYPTION_KEY");
  for (const k of c.requiredEnv) if (!env[k]) out.push(k);
  return out;
}

export const isConfigured = (c: ConnectorDef, env: Env) => missingEnv(c, env).length === 0;

/** Which connect methods are usable right now. */
export function connectMethods(c: ConnectorDef, env: Env): { oauth: boolean; apiKey: boolean } {
  if (!isConfigured(c, env)) return { oauth: false, apiKey: false };
  return { oauth: oauthConfigured(c, env), apiKey: !!c.apiKey };
}

export type UiStatus = "connected" | "expired" | "revoked" | "not_connected" | "setup_required";

export type ConnectorView = {
  id: string; name: string; icon: string; description: string; auth: ConnectorDef["auth"];
  scopes: string[]; capabilities: string[]; permissions: string[];
  status: UiStatus; accountLabel?: string;
  /** Scopes this connector now asks for that the user's connection didn't grant: show "Reconnect". */
  needsReconnect?: string[]; connectedAt?: string; lastUsedAt?: string | null;
  missingEnv: string[]; methods: { oauth: boolean; apiKey: boolean };
  apiKey?: { label: string; placeholder?: string; helpUrl: string; helpText: string };
  tools: { name: string; description: string; requiresApproval: "always" | "sometimes" | "never" }[];
};

/** What GET /api/connectors and the Connectors page show. Never includes credentials. */
export function connectorViews(env: Env, connections: ConnectionInfo[]): ConnectorView[] {
  return CONNECTORS.map((c) => {
    const conn = connections.find((x) => x.connector_id === c.id);
    const missing = missingEnv(c, env);
    const status: UiStatus = conn ? conn.status : missing.length ? "setup_required" : "not_connected";
    const lacking = conn && conn.status === "connected" && conn.scopes.length ? (c.addedScopes ?? []).filter((s) => !conn.scopes.includes(s)) : [];
    const preview = c.getTools(conn ?? { connector_id: c.id, status: "connected", scopes: c.scopes, account_label: "" });
    return {
      id: c.id, name: c.name, icon: c.icon, description: c.description, auth: c.auth,
      scopes: c.scopes, capabilities: c.capabilities, permissions: c.permissions,
      status, accountLabel: conn?.account_label || undefined, ...(lacking.length ? { needsReconnect: lacking } : {}), connectedAt: conn?.created_at, lastUsedAt: conn?.last_used_at ?? null,
      missingEnv: missing, methods: connectMethods(c, env),
      apiKey: c.apiKey ? { label: c.apiKey.label, placeholder: c.apiKey.placeholder, helpUrl: c.apiKey.helpUrl, helpText: c.apiKey.helpText } : undefined,
      tools: preview.map((t) => ({ name: t.name, description: t.description, requiresApproval: t.requiresApproval === true ? "always" : typeof t.requiresApproval === "function" ? "sometimes" : "never" })),
    };
  });
}
