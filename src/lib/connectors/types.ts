import type { z } from "zod";

export type Env = Record<string, string | undefined>;
export type AuthType = "oauth" | "api_key";
export type ConnectionStatus = "connected" | "expired" | "revoked";

/** What a connector's tools receive when they run. The token never leaves server code. */
export type ToolContext = {
  token: string;
  fetch: typeof fetch;
  /** Non-secret per-connection metadata saved at connect time (e.g. Vercel team id). */
  meta: Record<string, unknown>;
};

export type ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Short snake_case name, unique within the connector. Exposed to the model as `<connector>__<name>`. */
  name: string;
  description: string;
  input: S;
  /**
   * Destructive / outward-facing actions (DROP/DELETE/TRUNCATE SQL, production deploys, sending messages,
   * spending money) must be approved by the user first. A function lets one tool decide per call
   * (e.g. run_sql only needs approval for destructive statements).
   */
  requiresApproval?: boolean | ((args: z.infer<S>) => boolean);
  /** One-line, server-built description shown on the approval card. */
  summarize?: (args: z.infer<S>) => string;
  /**
   * Runs with the user's token BEFORE an approval card is created (read-only calls only): looks up what the
   * card must show (e.g. a repo's visibility before deleting it) and can refuse early (missing scope,
   * not found). Its preview is stored with the approval and shown on the card; it never changes the args.
   */
  prepare?: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolPreview>;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};

/** What an approval card shows for a prepared connector action, built by the server from provider data. */
export type ToolPreview = { summary?: string; details?: Record<string, string>; warning?: string };

/** Visible (non-secret) details of a stored connection. */
export type ConnectionInfo = {
  connector_id: string;
  status: ConnectionStatus;
  scopes: string[];
  account_label: string;
  meta?: Record<string, unknown>;
  created_at?: string;
  last_used_at?: string | null;
};

/** Decrypted credentials. Only ever held in server memory. */
export type Credentials = {
  type?: "oauth" | "api_key";
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at?: number;
  scope?: string;
  meta?: Record<string, unknown>;
};

export type TokenResult = { creds: Credentials; accountLabel: string; scopes: string[] };

export type OAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  /** Separate refresh endpoint when the provider uses one (e.g. Figma's /v1/oauth/refresh). Defaults to tokenUrl. */
  refreshUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** How the client authenticates at the token endpoint. */
  tokenAuth: "basic" | "body";
  /** Token endpoint body encoding (default form). */
  tokenBody?: "form" | "json";
  pkce?: boolean;
  scopeParam?: string;
  /** Don't send the scope parameter (the provider fixes scopes on the app, e.g. Supabase). */
  omitScope?: boolean;
  /** Build the whole authorize URL (non-standard flows like Vercel's integration install page). */
  buildAuthorizeUrl?: (env: Env, p: { redirectUri: string; state: string; codeChallenge?: string }) => string;
  /** Non-secret metadata to keep from the callback query string (e.g. Vercel configurationId / teamId). */
  callbackMeta?: (q: URLSearchParams) => Record<string, unknown>;
  scopeSeparator?: string;
  extraAuthorizeParams?: Record<string, string>;
  /** Pull the token fields out of a non-standard token response (e.g. Slack's authed_user). */
  parseToken?: (json: Record<string, unknown>) => Partial<Credentials> & { access_token?: string };
  /** Find a human-readable account label after the exchange. Must not return secrets. */
  accountLabel?: (token: string, json: Record<string, unknown>, f: typeof fetch) => Promise<string>;
  /** Best-effort revocation at the provider. */
  revoke?: (creds: Credentials, env: Env, f: typeof fetch) => Promise<void>;
  /** Whether refresh_token grants are supported. */
  refreshable?: boolean;
};

export type ApiKeyConfig = {
  label: string;
  placeholder?: string;
  /** Where the user creates the key/token. */
  helpUrl: string;
  helpText: string;
  /** Test call with the key. Throws a user-safe error if invalid. */
  validate: (key: string, f: typeof fetch) => Promise<{ accountLabel: string; scopes?: string[]; meta?: Record<string, unknown> }>;
  revoke?: (creds: Credentials, env: Env, f: typeof fetch) => Promise<void>;
};

export type ConnectorDef = {
  id: string;
  name: string;
  /** Short glyph rendered in the card's tile. */
  icon: string;
  description: string;
  auth: AuthType;
  /** Minimum scopes requested (oauth) or recommended token permissions (api_key). */
  scopes: string[];
  /**
   * Scopes added to `scopes` after people had already connected. A connection whose granted scopes lack one
   * of these shows "Reconnect" on the Connectors page so the user can grant it.
   */
  addedScopes?: string[];
  /** Plain-English list of what the agent can do with it. */
  capabilities: string[];
  /** Plain-English explanation of the permissions, shown before connecting. */
  permissions: string[];
  /** Server env vars that must be set before anyone can connect. Names only. */
  requiredEnv: string[];
  oauth?: OAuthConfig;
  apiKey?: ApiKeyConfig;
  /** Official API / MCP documentation used for this connector (shown in setup docs). */
  docs: string[];
  /** Unfinished parts, shown in the setup guide. */
  todo?: string[];
  getTools: (connection: ConnectionInfo) => ToolDef[];
};
