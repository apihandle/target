import { randomBytes } from "node:crypto";
import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError, MissingScopeError } from "@/lib/connectors/http";
import { isDestructiveSql, isReadOnlySql } from "@/lib/connectors/safety";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";

/**
 * Supabase, via the official Management API (https://api.supabase.com/v1).
 *
 * Why REST and not the hosted MCP server (https://mcp.supabase.com/mcp): the MCP server authenticates
 * with OAuth 2.1 + dynamic client registration or a PAT header and wraps the same Management API.
 * Calling the REST endpoints directly from our server gives the same capabilities with per-user tokens,
 * no extra MCP session/transport layer, and lets us enforce approvals per call before anything is sent.
 *
 * Auth: OAuth 2.0 with PKCE through TARGET's Supabase OAuth app (SUPABASE_OAUTH_CLIENT_ID / _SECRET).
 * Scopes are fixed on the app (Supabase → Organization settings → OAuth Apps), so none are sent at authorize
 * time. Access tokens are short-lived and are refreshed with the refresh token
 * (https://supabase.com/docs/guides/integrations/build-a-supabase-integration). Each endpoint's OAuth scope is
 * the "OAuth scope: …" badge in https://api.supabase.com/api/v1-json; a 403 on a scope that was added after the
 * user connected becomes "Reconnect Supabase to allow this".
 *
 * Secrets never reach the chat: API keys are masked, secret values and auth-provider secrets are never returned,
 * and the storage tools fetch the project's secret key server-side only for the one storage request.
 */
const API = "https://api.supabase.com/v1";
const CONNECTOR = "supabase";
const NAME = "Supabase";
const ref = z.string().regex(/^[a-z]{20}$/, "Project ref is the 20-letter id in the project URL").describe("Project ref (20 lowercase letters), from list_projects");
const orgSlug = z.string().regex(/^[\w-]{1,64}$/, "Organization slug, from list_organizations");

/** Scopes asked for when TARGET first shipped Supabase. */
const BASE_SCOPES = ["projects:read", "database:read", "database:write", "edge_functions:write"];
/** Added 2026-11-04 for full project management. The owner enables them on the OAuth app; old connections reconnect. */
const ADDED_SCOPES = ["projects:write", "organizations:read", "edge_functions:read", "secrets:read", "secrets:write", "storage:read", "auth:read", "auth:write", "analytics:read", "environment:read"];

type Init = Parameters<typeof apiFetch>[1] & { need?: string };

/** Management API call. A 403 on a scope added after the user connected asks them to reconnect instead of failing. */
async function call<T = unknown>(ctx: ToolContext, path: string, init: Init = {}): Promise<T> {
  const { need, ...rest } = init;
  try {
    return await apiFetch<T>(`${API}${path}`, { ...rest, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}`, ...(rest.headers as Record<string, string> | undefined) } });
  } catch (e) {
    if (e instanceof ConnectorError && e.status === 403 && need) {
      if (ADDED_SCOPES.includes(need) || /scope/i.test(e.message)) throw new MissingScopeError(CONNECTOR, NAME, need);
      throw new ConnectorError(`${e.message}. Your role in this Supabase organization may not allow this, or TARGET's Supabase access lacks "${need}".`, 403, "auth");
    }
    throw e;
  }
}

/** The project's own Storage API (https://<ref>.supabase.co/storage/v1). The host is fixed by the validated ref. */
async function storage<T = unknown>(ctx: ToolContext, projectRef: string, path: string, init: Parameters<typeof apiFetch>[1] = {}): Promise<T> {
  const key = await serviceKey(ctx, projectRef);
  return apiFetch<T>(`https://${projectRef}.supabase.co/storage/v1${path}`, { ...init, f: ctx.fetch, headers: { apikey: key, Authorization: `Bearer ${key}` } });
}

type ApiKey = { api_key?: string | null; id?: string; type?: string; prefix?: string; name?: string; description?: string | null; inserted_at?: string; updated_at?: string };
/** Server-side only: the project's secret (or legacy service_role) key for one Storage call. Never returned. */
async function serviceKey(ctx: ToolContext, projectRef: string): Promise<string> {
  const keys = await call<ApiKey[]>(ctx, `/projects/${projectRef}/api-keys?reveal=true`, { need: "secrets:read" });
  const list = Array.isArray(keys) ? keys : [];
  const k = list.find((x) => x.type === "secret" && x.api_key) ?? list.find((x) => x.name === "service_role" && x.api_key);
  if (!k?.api_key) throw new ConnectorError("This project has no secret API key that TARGET can use for Storage. Create one in Supabase → Project settings → API keys.", 400, "invalid");
  return k.api_key;
}

const PUBLIC_KEY_TYPES = new Set(["publishable", "anon"]);
/** Masked view of a key: public keys keep a short recognisable start, secret keys only show their last 4 characters. */
export function maskKey(k: ApiKey): string {
  const v = typeof k.api_key === "string" ? k.api_key : "";
  if (!v) return k.prefix ? `${k.prefix}… (hidden)` : "(hidden)";
  const isPublic = PUBLIC_KEY_TYPES.has(String(k.type)) || k.name === "anon";
  if (isPublic) return `${v.startsWith("sb_publishable_") ? v.slice(0, 20) : v.slice(0, 6)}…${v.slice(-4)}`;
  return `•••••••• (secret, ends …${v.slice(-4)})`;
}
const keyView = (k: ApiKey) => ({ id: k.id, name: k.name, type: k.type, description: k.description ?? undefined, key: maskKey(k), secret: !(PUBLIC_KEY_TYPES.has(String(k.type)) || k.name === "anon"), updated_at: k.updated_at });

/** Auth config fields that hold secrets: never returned, and masked on approval cards. */
export const isSecretAuthField = (k: string) => /(secret|_pass$|password$|auth_token|api_key|access_key|api_secret|_secrets$|private_key|client_secret)/i.test(k) && !/(enabled|min_length|required_characters|hibp|require_|reuse_interval|_url$|_uri$)/i.test(k);
const maskAuth = (k: string, v: unknown) => (isSecretAuthField(k) ? (v === null || v === "" || v === undefined ? "(not set)" : "•••••••• (hidden)") : v);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(not set)" : typeof v === "string" ? v : JSON.stringify(v));

type Project = { id?: string; ref?: string; name?: string; region?: string; status?: string; organization_id?: string; organization_slug?: string; created_at?: string; database?: { version?: string } };
const projectOf = (ctx: ToolContext, r: string) => call<Project>(ctx, `/projects/${r}`, { need: "projects:read" });
const day = (iso?: string) => (iso && !isNaN(Date.parse(iso)) ? iso.slice(0, 10) : "unknown");
/** TARGET's own database: changing it can take this app down, so cards say so. */
const ownRef = () => /^https:\/\/([a-z]{20})\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
const ownWarning = (r: string) => (ownRef() === r ? " This is the project TARGET itself runs on." : "");
const projectRows = (p: Project, r: string): Record<string, string> => ({ Project: `${p.name ?? r} (${r})`, Region: String(p.region ?? "unknown"), Status: String(p.status ?? "unknown"), Created: day(p.created_at) });
/** Built from the arguments only (no provider call before the user decides), so the card shows the exact SQL. */
const sqlPreview = async (r: string, query: string, label: string): Promise<ToolPreview> => ({
  summary: `${label} on Supabase project ${r}`,
  details: { Project: r, SQL: query.length > 1800 ? `${query.slice(0, 1800)}\n…(${query.length - 1800} more characters)` : query },
  warning: `This SQL can change or delete data and can't be undone by TARGET. Check it before approving.${ownWarning(r)}`,
});

const LIST_TABLES_SQL = (schemas: string[]) => `
select n.nspname as schema, c.relname as name, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  greatest(c.reltuples, 0)::bigint as estimated_rows
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in (${schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")})
order by 1, 2 limit 500;`;

const LOG_SOURCES = ["edge_logs", "postgres_logs", "auth_logs", "function_logs", "function_edge_logs", "storage_logs", "realtime_logs", "postgrest_logs", "supavisor_logs"] as const;
/** ClickHouse SQL for the unified logs stream; every user value is escaped. */
export function logsSql(a: { source?: string; search?: string; limit: number }) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const where = [a.source ? `source = '${esc(a.source)}'` : "", a.search ? `positionCaseInsensitive(event_message, '${esc(a.search)}') > 0` : ""].filter(Boolean);
  return `select timestamp, source, event_message from logs${where.length ? ` where ${where.join(" and ")}` : ""} order by timestamp desc limit ${a.limit}`;
}

const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,255}$/, "Letters, digits and _").refine((n) => !/^SUPABASE_/i.test(n), "Names starting with SUPABASE_ are reserved");
const bucketId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/, "Lowercase letters, digits, dot, dash, underscore");
const slug = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,62}$/);
const authValue = z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]);
const REGIONS = ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "ap-east-1", "ap-southeast-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-2", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "eu-central-1", "eu-central-2", "ca-central-1", "ap-south-1", "sa-east-1"] as const;

type Org = { id?: string; slug?: string; name?: string; plan?: string };
async function freeOrg(ctx: ToolContext, slugArg?: string): Promise<Org> {
  let s = slugArg;
  if (!s) {
    const orgs = await call<Org[]>(ctx, "/organizations", { need: "organizations:read" });
    const list = Array.isArray(orgs) ? orgs : [];
    if (list.length !== 1) throw new ConnectorError(list.length ? `Several organizations are connected (${list.map((o) => o.slug ?? o.id).join(", ")}); say which one.` : "No Supabase organization is reachable with this connection.", 400, "invalid");
    s = String(list[0].slug ?? list[0].id);
  }
  const org = await call<Org>(ctx, `/organizations/${encodeURIComponent(s)}`, { need: "organizations:read" });
  if (org.plan && org.plan !== "free") throw new ConnectorError(`Organization ${org.name ?? s} is on the ${org.plan} plan, where every new project adds compute charges. TARGET only creates free-tier projects, in a free organization.`, 400, "invalid");
  return { ...org, slug: org.slug ?? s };
}

export const supabase = defineConnector({
  id: "supabase",
  name: "Supabase",
  icon: "S",
  description: "Manage your Supabase projects: SQL, migrations, Edge Functions, secrets, API keys, storage, auth settings and logs.",
  auth: "oauth",
  scopes: [...BASE_SCOPES, ...ADDED_SCOPES],
  addedScopes: ADDED_SCOPES,
  capabilities: [
    "List organizations, members and projects; create free-tier projects (asks you first)",
    "Pause, restore or delete a project (asks you first)",
    "List tables, run SQL (reads run read-only), list and apply migrations, generate TypeScript types",
    "List, deploy and delete Edge Functions (deploy and delete ask you first)",
    "List API keys (always masked) and manage Edge Function secrets (values are never shown; deleting asks you first)",
    "List, create and delete storage buckets (deleting asks you first)",
    "Read logs, read auth settings (secrets hidden) and change them (asks you first)",
    "DROP / DELETE / TRUNCATE / UPDATE / ALTER statements always wait for your approval",
  ],
  permissions: [
    "You sign in on Supabase and pick the organization TARGET may manage.",
    "Access is encrypted on TARGET's server. Revoke it any time in Supabase → Organization settings → OAuth Apps (authorized apps).",
  ],
  requiredEnv: ["SUPABASE_OAUTH_CLIENT_ID", "SUPABASE_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: `${API}/oauth/authorize`,
    tokenUrl: `${API}/oauth/token`,
    clientIdEnv: "SUPABASE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SUPABASE_OAUTH_CLIENT_SECRET",
    tokenAuth: "basic",
    pkce: true,
    omitScope: true,
    refreshable: true,
    async accountLabel(token, _j, f) {
      const orgs = await apiFetch<{ name?: string }[]>(`${API}/organizations`, { f, headers: { Authorization: `Bearer ${token}` } });
      const names = (Array.isArray(orgs) ? orgs : []).map((o) => o.name).filter(Boolean);
      return names.length ? names.slice(0, 2).join(", ") : "";
    },
    async revoke(creds, env, f) {
      if (!creds.refresh_token || !env.SUPABASE_OAUTH_CLIENT_ID) return;
      await apiFetch(`${API}/oauth/revoke`, { method: "POST", f, body: { client_id: env.SUPABASE_OAUTH_CLIENT_ID, client_secret: env.SUPABASE_OAUTH_CLIENT_SECRET, refresh_token: creds.refresh_token } }).catch(() => undefined);
    },
  },
  docs: [
    "https://supabase.com/docs/reference/api/introduction",
    "https://api.supabase.com/api/v1-json",
    "https://supabase.com/docs/guides/integrations/build-a-supabase-integration",
    "https://supabase.com/docs/reference/self-hosting-storage/create-a-bucket",
    "https://supabase.com/docs/guides/getting-started/mcp",
  ],
  getTools: () => [
    // ── Organizations and projects ──────────────────────────────────────────────────────────────
    tool({
      name: "list_organizations",
      description: "List the Supabase organizations this connection can reach (id, slug, name).",
      input: z.object({}),
      async execute(_a, ctx) {
        const orgs = await call<Org[]>(ctx, "/organizations", { need: "organizations:read" });
        return (Array.isArray(orgs) ? orgs : []).map((o) => ({ id: o.id, slug: o.slug ?? o.id, name: o.name }));
      },
    }),
    tool({
      name: "list_org_members",
      description: "List the members of a Supabase organization (name, email, role, MFA).",
      input: z.object({ organization_slug: orgSlug }),
      async execute(a, ctx) {
        const ms = await call<Record<string, unknown>[]>(ctx, `/organizations/${encodeURIComponent(a.organization_slug)}/members`, { need: "organizations:read" });
        return (Array.isArray(ms) ? ms : []).map((m) => ({ user_name: m.user_name, email: m.email, role: m.role_name, mfa_enabled: m.mfa_enabled }));
      },
    }),
    tool({
      name: "list_projects",
      description: "List the Supabase projects this connection can reach (ref, name, region, status).",
      input: z.object({}),
      async execute(_a, ctx) {
        const ps = await call<Record<string, unknown>[]>(ctx, "/projects", { need: "projects:read" });
        return (Array.isArray(ps) ? ps : []).map((p) => ({ ref: p.id ?? p.ref, name: p.name, region: p.region, status: p.status, organization_id: p.organization_id }));
      },
    }),
    tool({
      name: "get_project_url",
      description: "Get the API URL and status of a Supabase project.",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const p = await projectOf(ctx, a.project_ref);
        return { ref: a.project_ref, name: p.name, url: `https://${a.project_ref}.supabase.co`, status: p.status, region: p.region };
      },
    }),
    tool({
      name: "create_project",
      description: "Create a new FREE-tier Supabase project in a free organization (never a paid plan). The user approves first. A strong database password is generated and not shown; they can reset it in the dashboard.",
      input: z.object({
        name: z.string().min(1).max(64),
        organization_slug: orgSlug.optional().describe("Organization slug; may be omitted when only one organization is connected"),
        region: z.enum(REGIONS).default("ap-south-1"),
      }),
      requiresApproval: true,
      summarize: (a) => `Create free Supabase project “${a.name}”`,
      async prepare(a, ctx) {
        const org = await freeOrg(ctx, a.organization_slug);
        return {
          summary: `Create free Supabase project “${a.name}” in ${org.name ?? org.slug}`,
          details: { Name: a.name, Organization: `${org.name ?? org.slug} (${org.slug})`, Plan: "Free (no charges)", Region: a.region },
          warning: "A free organization can have only 2 active projects; Supabase pauses free projects after a week without activity.",
        };
      },
      async execute(a, ctx) {
        const org = await freeOrg(ctx, a.organization_slug);
        const dbPass = randomBytes(24).toString("base64url");
        const p = await call<Project>(ctx, "/projects", { method: "POST", need: "projects:write", body: { name: a.name, organization_slug: org.slug, region: a.region, plan: "free", db_pass: dbPass }, timeoutMs: 45000 });
        const r = String(p.ref ?? p.id);
        return { ref: r, name: p.name, region: p.region, status: p.status, url: `https://${r}.supabase.co`, plan: "free", database_password: "generated and not shown; reset it in Supabase → Project settings → Database" };
      },
    }),
    tool({
      name: "pause_project",
      description: "Pause a Supabase project (its API and database stop until restored). The user approves first.",
      input: z.object({ project_ref: ref }),
      requiresApproval: true,
      summarize: (a) => `Pause Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const p = await projectOf(ctx, a.project_ref);
        if (p.status === "INACTIVE" || p.status === "PAUSING") throw new ConnectorError(`${p.name ?? a.project_ref} is already paused.`, 400, "invalid");
        return { summary: `Pause Supabase project ${p.name ?? a.project_ref}`, details: projectRows(p, a.project_ref), warning: `Its database, API, auth and storage go offline until you restore it.${ownWarning(a.project_ref)}` };
      },
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/pause`, { method: "POST", need: "projects:write" });
        return { paused: a.project_ref };
      },
    }),
    tool({
      name: "restore_project",
      description: "Restore (unpause) a paused Supabase project. The user approves first.",
      input: z.object({ project_ref: ref }),
      requiresApproval: true,
      summarize: (a) => `Restore Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const p = await projectOf(ctx, a.project_ref);
        if (p.status && p.status !== "INACTIVE") throw new ConnectorError(`${p.name ?? a.project_ref} isn't paused (status ${p.status}).`, 400, "invalid");
        return { summary: `Restore Supabase project ${p.name ?? a.project_ref}`, details: projectRows(p, a.project_ref), warning: "Restoring takes a few minutes and counts toward the organization's active-project limit." };
      },
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/restore`, { method: "POST", need: "projects:write" });
        return { restoring: a.project_ref };
      },
    }),
    tool({
      name: "delete_project",
      description: "Permanently delete a Supabase project with its database, storage and functions. The user approves the exact project on an approval card first; call this instead of telling them to do it manually.",
      input: z.object({ project_ref: ref }),
      requiresApproval: true,
      summarize: (a) => `Delete Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const p = await projectOf(ctx, a.project_ref);
        return {
          summary: `Delete Supabase project ${p.name ?? a.project_ref}`,
          details: projectRows(p, a.project_ref),
          warning: `This PERMANENTLY deletes the project with its database, auth users, storage files, Edge Functions and backups. TARGET can't undo it.${ownWarning(a.project_ref)}`,
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}`, { method: "DELETE", need: "projects:write" });
        return { deleted: a.project_ref };
      },
    }),

    // ── Database ────────────────────────────────────────────────────────────────────────────────
    tool({
      name: "list_tables",
      description: "List tables (with column count and whether row level security is on) in the given schemas.",
      input: z.object({ project_ref: ref, schemas: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/)).max(10).default(["public"]) }),
      async execute(a, ctx) {
        return call(ctx, `/projects/${a.project_ref}/database/query/read-only`, { method: "POST", need: "database:read", body: { query: LIST_TABLES_SQL(a.schemas) } });
      },
    }),
    tool({
      name: "run_sql",
      description: "Run SQL on a Supabase project's Postgres database. Plain reads run in read-only mode. DROP/DELETE/TRUNCATE/UPDATE/ALTER/GRANT and dynamic SQL require the user's approval first (call it anyway; they get a card).",
      input: z.object({ project_ref: ref, query: z.string().min(1).max(20000) }),
      requiresApproval: (a) => isDestructiveSql(a.query),
      summarize: (a) => `Run SQL on Supabase project ${a.project_ref}`,
      prepare: (a) => sqlPreview(a.project_ref, a.query, "Run SQL"),
      async execute(a, ctx) {
        const readOnly = isReadOnlySql(a.query);
        const path = readOnly ? `/projects/${a.project_ref}/database/query/read-only` : `/projects/${a.project_ref}/database/query`;
        const rows = await call(ctx, path, { method: "POST", need: readOnly ? "database:read" : "database:write", body: { query: a.query } });
        return { read_only: readOnly, result: rows };
      },
    }),
    tool({
      name: "list_migrations",
      description: "List the migrations recorded in a project's migration history (version, name).",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const ms = await call<{ version?: string; name?: string }[]>(ctx, `/projects/${a.project_ref}/database/migrations`, { need: "database:read" });
        return (Array.isArray(ms) ? ms : []).map((m) => ({ version: m.version, name: m.name }));
      },
    }),
    tool({
      name: "apply_migration",
      description: "Apply a named SQL migration to a Supabase project (recorded in its migration history). Destructive SQL requires approval.",
      input: z.object({ project_ref: ref, name: z.string().regex(/^[a-z0-9_]{1,100}$/, "snake_case name"), query: z.string().min(1).max(50000) }),
      requiresApproval: (a) => isDestructiveSql(a.query),
      summarize: (a) => `Apply migration “${a.name}” to Supabase project ${a.project_ref}`,
      prepare: (a) => sqlPreview(a.project_ref, a.query, `Apply migration “${a.name}”`),
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/database/migrations`, { method: "POST", need: "database:write", body: { name: a.name, query: a.query }, headers: { "Idempotency-Key": `${a.project_ref}-${a.name}` } });
        return { applied: a.name };
      },
    }),
    tool({
      name: "generate_typescript_types",
      description: "Generate TypeScript types for a project's database schemas (like `supabase gen types typescript`).",
      input: z.object({ project_ref: ref, schemas: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/)).min(1).max(10).default(["public"]) }),
      async execute(a, ctx) {
        const r = await call<{ types?: string }>(ctx, `/projects/${a.project_ref}/types/typescript?included_schemas=${encodeURIComponent(a.schemas.join(","))}`, { need: "database:read", timeoutMs: 30000 });
        return { schemas: a.schemas, types: r.types ?? "" };
      },
    }),
    tool({
      name: "list_branches",
      description: "List a project's database (preview) branches. Branching itself is a paid Supabase feature, so TARGET only lists branches.",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        try {
          const bs = await call<Record<string, unknown>[]>(ctx, `/projects/${a.project_ref}/branches`, { need: "environment:read" });
          return (Array.isArray(bs) ? bs : []).map((b) => ({ id: b.id, name: b.name, project_ref: b.project_ref, is_default: b.is_default, git_branch: b.git_branch, status: b.status }));
        } catch (e) {
          if (e instanceof ConnectorError && (e.status === 404 || e.status === 422 || e.status === 400) && !(e instanceof MissingScopeError)) return { branches: [], note: "Branching isn't enabled on this project (it is a paid Supabase feature)." };
          throw e;
        }
      },
    }),

    // ── Edge Functions ──────────────────────────────────────────────────────────────────────────
    tool({
      name: "list_edge_functions",
      description: "List a project's Edge Functions (slug, status, version, verify_jwt, updated).",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const fs = await call<Record<string, unknown>[]>(ctx, `/projects/${a.project_ref}/functions`, { need: "edge_functions:read" });
        return (Array.isArray(fs) ? fs : []).map((f) => ({ slug: f.slug, name: f.name, status: f.status, version: f.version, verify_jwt: f.verify_jwt, updated_at: f.updated_at, url: `https://${a.project_ref}.supabase.co/functions/v1/${String(f.slug)}` }));
      },
    }),
    tool({
      name: "deploy_edge_function",
      description: "Deploy (create or update) an Edge Function. This publishes code to the project's live endpoint, so it always requires approval.",
      input: z.object({
        project_ref: ref,
        slug,
        entrypoint_path: z.string().max(200).default("index.ts"),
        verify_jwt: z.boolean().default(true),
        files: z.array(z.object({ name: z.string().min(1).max(200), content: z.string().max(200000) })).min(1).max(20),
      }),
      requiresApproval: true,
      summarize: (a) => `Deploy Edge Function “${a.slug}” to Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const p = await projectOf(ctx, a.project_ref);
        return {
          summary: `Deploy Edge Function “${a.slug}” to ${p.name ?? a.project_ref}`,
          details: { ...projectRows(p, a.project_ref), Function: a.slug, Entrypoint: a.entrypoint_path, "Verify JWT": a.verify_jwt ? "yes" : "no (public)", Files: a.files.map((f) => `${f.name} (${f.content.length} chars)`).join("\n") },
          warning: `This publishes code to https://${a.project_ref}.supabase.co/functions/v1/${a.slug} and replaces the live version.`,
        };
      },
      async execute(a, ctx) {
        const form = new FormData();
        form.append("metadata", JSON.stringify({ entrypoint_path: a.entrypoint_path, verify_jwt: a.verify_jwt, name: a.slug }));
        for (const file of a.files) form.append("file", new Blob([file.content], { type: "application/typescript" }), file.name);
        const r = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/functions/deploy?slug=${encodeURIComponent(a.slug)}`, { method: "POST", need: "edge_functions:write", body: form, timeoutMs: 45000 });
        return { slug: r.slug, version: r.version, status: r.status, url: `https://${a.project_ref}.supabase.co/functions/v1/${a.slug}` };
      },
    }),
    tool({
      name: "delete_edge_function",
      description: "Delete an Edge Function (its live endpoint stops working). The user approves first.",
      input: z.object({ project_ref: ref, slug }),
      requiresApproval: true,
      summarize: (a) => `Delete Edge Function “${a.slug}” from Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const [p, f] = await Promise.all([projectOf(ctx, a.project_ref), call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/functions/${encodeURIComponent(a.slug)}`, { need: "edge_functions:read" })]);
        return {
          summary: `Delete Edge Function “${a.slug}” from ${p.name ?? a.project_ref}`,
          details: { Project: `${p.name ?? a.project_ref} (${a.project_ref})`, Function: a.slug, Version: show(f.version), Status: show(f.status), Updated: show(f.updated_at) },
          warning: `https://${a.project_ref}.supabase.co/functions/v1/${a.slug} stops working immediately. TARGET can't restore the deleted code.`,
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/functions/${encodeURIComponent(a.slug)}`, { method: "DELETE", need: "edge_functions:write" });
        return { deleted: a.slug };
      },
    }),

    // ── API keys and secrets (values never reach the chat) ──────────────────────────────────────
    tool({
      name: "list_api_keys",
      description: "List a project's API keys (name, type, masked value). Values are always masked; TARGET never shows a secret key.",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const keys = await call<ApiKey[]>(ctx, `/projects/${a.project_ref}/api-keys`, { need: "secrets:read" });
        return (Array.isArray(keys) ? keys : []).map(keyView);
      },
    }),
    tool({
      name: "get_api_key",
      description: "Get one API key's details (masked value).",
      input: z.object({ project_ref: ref, id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
      async execute(a, ctx) {
        return keyView(await call<ApiKey>(ctx, `/projects/${a.project_ref}/api-keys/${encodeURIComponent(a.id)}`, { need: "secrets:read" }));
      },
    }),
    tool({
      name: "list_secrets",
      description: "List the names of a project's Edge Function secrets. Values are never returned.",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const ss = await call<{ name?: string; updated_at?: string }[]>(ctx, `/projects/${a.project_ref}/secrets`, { need: "secrets:read" });
        return (Array.isArray(ss) ? ss : []).map((s) => ({ name: s.name, value: "(hidden)", updated_at: s.updated_at }));
      },
    }),
    tool({
      name: "set_secrets",
      description: "Create or update Edge Function secrets (name + value). Values are sent to Supabase and never echoed back.",
      input: z.object({ project_ref: ref, secrets: z.array(z.object({ name: secretName, value: z.string().min(1).max(24000) })).min(1).max(30) }),
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/secrets`, { method: "POST", need: "secrets:write", body: a.secrets });
        return { set: a.secrets.map((s) => s.name) };
      },
    }),
    tool({
      name: "delete_secrets",
      description: "Delete Edge Function secrets by name. The user approves first.",
      input: z.object({ project_ref: ref, names: z.array(secretName).min(1).max(30) }),
      requiresApproval: true,
      summarize: (a) => `Delete ${a.names.length} secret(s) from Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const ss = await call<{ name?: string }[]>(ctx, `/projects/${a.project_ref}/secrets`, { need: "secrets:read" });
        const have = new Set((Array.isArray(ss) ? ss : []).map((s) => s.name));
        const missing = a.names.filter((n) => !have.has(n));
        if (missing.length === a.names.length) throw new ConnectorError(`None of these secrets exist: ${missing.join(", ")}`, 404, "not_found");
        return {
          summary: `Delete ${a.names.length} Edge Function secret(s) from ${a.project_ref}`,
          details: { Project: a.project_ref, Secrets: a.names.join("\n"), ...(missing.length ? { "Not found (skipped by Supabase)": missing.join(", ") } : {}) },
          warning: "Edge Functions that read these secrets will fail until they are set again. The values can't be recovered.",
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/secrets`, { method: "DELETE", need: "secrets:write", body: a.names });
        return { deleted: a.names };
      },
    }),

    // ── Storage ─────────────────────────────────────────────────────────────────────────────────
    tool({
      name: "list_buckets",
      description: "List a project's storage buckets (id, public, size limit, allowed types).",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const bs = await call<Record<string, unknown>[]>(ctx, `/projects/${a.project_ref}/storage/buckets`, { need: "storage:read" });
        return (Array.isArray(bs) ? bs : []).map((b) => ({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types, created_at: b.created_at }));
      },
    }),
    tool({
      name: "create_bucket",
      description: "Create a storage bucket. Private by default; a public bucket makes every file readable by URL, so that asks the user first.",
      input: z.object({
        project_ref: ref, id: bucketId, public: z.boolean().default(false),
        file_size_limit: z.number().int().min(1).max(5 * 1024 * 1024 * 1024).optional().describe("Bytes"),
        allowed_mime_types: z.array(z.string().regex(/^[\w.+-]+\/[\w.+*-]+$/)).max(50).optional(),
      }),
      requiresApproval: (a) => a.public === true,
      summarize: (a) => `Create public storage bucket “${a.id}” on Supabase project ${a.project_ref}`,
      async prepare(a) {
        return { summary: `Create PUBLIC storage bucket “${a.id}”`, details: { Project: a.project_ref, Bucket: a.id, Access: "Public: anyone with a file's URL can read it" }, warning: "Files in a public bucket are readable by anyone who has the URL." };
      },
      async execute(a, ctx) {
        await storage(ctx, a.project_ref, "/bucket", { method: "POST", body: { id: a.id, name: a.id, public: a.public, ...(a.file_size_limit ? { file_size_limit: a.file_size_limit } : {}), ...(a.allowed_mime_types ? { allowed_mime_types: a.allowed_mime_types } : {}) } });
        return { created: a.id, public: a.public };
      },
    }),
    tool({
      name: "delete_bucket",
      description: "Delete a storage bucket. With empty_first it deletes every file in it first (otherwise Supabase refuses non-empty buckets). The user approves first.",
      input: z.object({ project_ref: ref, id: bucketId, empty_first: z.boolean().default(false) }),
      requiresApproval: true,
      summarize: (a) => `Delete storage bucket “${a.id}” from Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const bs = await call<Record<string, unknown>[]>(ctx, `/projects/${a.project_ref}/storage/buckets`, { need: "storage:read" });
        const b = (Array.isArray(bs) ? bs : []).find((x) => x.id === a.id);
        if (!b) throw new ConnectorError(`Bucket “${a.id}” doesn't exist in ${a.project_ref}.`, 404, "not_found");
        return {
          summary: `Delete storage bucket “${a.id}”${a.empty_first ? " and all its files" : ""}`,
          details: { Project: a.project_ref, Bucket: a.id, Access: b.public ? "Public" : "Private", Created: day(String(b.created_at ?? "")), "Delete files first": a.empty_first ? "yes, every file in it" : "no (fails if not empty)" },
          warning: `${a.empty_first ? "Every file in this bucket is permanently deleted. " : ""}TARGET can't undo it.${ownWarning(a.project_ref)}`,
        };
      },
      async execute(a, ctx) {
        if (a.empty_first) await storage(ctx, a.project_ref, `/bucket/${encodeURIComponent(a.id)}/empty`, { method: "POST" });
        await storage(ctx, a.project_ref, `/bucket/${encodeURIComponent(a.id)}`, { method: "DELETE" });
        return { deleted: a.id, emptied: a.empty_first };
      },
    }),

    // ── Auth settings and logs ──────────────────────────────────────────────────────────────────
    tool({
      name: "get_auth_config",
      description: "Read a project's auth settings (site URL, redirect URLs, providers, sign-up, email, JWT expiry…). Secret fields are hidden. Pass fields to read specific keys.",
      input: z.object({ project_ref: ref, fields: z.array(z.string().regex(/^[a-z0-9_]{1,80}$/)).max(40).optional() }),
      async execute(a, ctx) {
        const cfg = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/config/auth`, { need: "auth:read" });
        const COMMON = ["site_url", "uri_allow_list", "disable_signup", "external_email_enabled", "external_phone_enabled", "external_anonymous_users_enabled", "mailer_autoconfirm", "jwt_exp", "password_min_length", "mfa_max_enrolled_factors", "security_captcha_enabled", "sessions_timebox", "smtp_host", "smtp_admin_email"];
        const keys = a.fields?.length ? a.fields : [...COMMON, ...Object.keys(cfg).filter((k) => /^external_[a-z0-9_]+_enabled$/.test(k) && cfg[k] === true)];
        return Object.fromEntries([...new Set(keys)].filter((k) => k in cfg).map((k) => [k, maskAuth(k, cfg[k])]));
      },
    }),
    tool({
      name: "update_auth_config",
      description: "Change a project's auth settings (e.g. site_url, uri_allow_list, disable_signup, external_google_enabled). The user approves the exact changes first; secret values are masked on the card.",
      input: z.object({ project_ref: ref, changes: z.record(z.string().regex(/^[a-z0-9_]{1,80}$/), authValue).refine((c) => Object.keys(c).length >= 1 && Object.keys(c).length <= 40, "1 to 40 settings") }),
      requiresApproval: true,
      summarize: (a) => `Change ${Object.keys(a.changes).length} auth setting(s) on Supabase project ${a.project_ref}`,
      async prepare(a, ctx) {
        const cfg = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/config/auth`, { need: "auth:read" });
        const unknown = Object.keys(a.changes).filter((k) => !(k in cfg));
        if (unknown.length) throw new ConnectorError(`Unknown auth setting(s): ${unknown.join(", ")}`, 400, "invalid");
        const rows = Object.entries(a.changes).map(([k, v]) => `${k}: ${show(maskAuth(k, cfg[k]))} → ${show(maskAuth(k, v))}`);
        return {
          summary: `Change ${rows.length} auth setting(s) on ${a.project_ref}`,
          details: { Project: a.project_ref, Changes: rows.join("\n") },
          warning: `Auth changes apply immediately to sign-in for every user of this project.${ownWarning(a.project_ref)}`,
        };
      },
      async execute(a, ctx) {
        const r = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/config/auth`, { method: "PATCH", need: "auth:write", body: a.changes });
        return { updated: Object.fromEntries(Object.keys(a.changes).map((k) => [k, maskAuth(k, r[k] ?? a.changes[k])])) };
      },
    }),
    tool({
      name: "get_logs",
      description: "Read a project's recent logs (newest first) from one source (edge_logs = API gateway, postgres_logs, auth_logs, function_logs, storage_logs, …), optionally filtered by text. Up to the last 24 hours.",
      input: z.object({
        project_ref: ref,
        source: z.enum(LOG_SOURCES).optional(),
        search: z.string().max(200).optional(),
        minutes: z.number().int().min(1).max(1440).default(60),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      async execute(a, ctx) {
        const end = new Date(), start = new Date(end.getTime() - a.minutes * 60000);
        const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
        const q = new URLSearchParams({ sql: logsSql(a), iso_timestamp_start: iso(start), iso_timestamp_end: iso(end) });
        const r = await call<{ result?: Record<string, unknown>[]; error?: unknown }>(ctx, `/projects/${a.project_ref}/analytics/endpoints/logs?${q}`, { need: "analytics:read", timeoutMs: 30000 });
        if (r.error) throw new ConnectorError(`Supabase logs: ${typeof r.error === "string" ? r.error : JSON.stringify(r.error)}`.slice(0, 300), 400, "invalid");
        return (r.result ?? []).map((l) => ({ timestamp: l.timestamp, source: l.source, message: String(l.event_message ?? "").slice(0, 500) }));
      },
    }),
  ],
});
