import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import { isDestructiveSql, isReadOnlySql } from "@/lib/connectors/safety";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Supabase, via the official Management API (https://api.supabase.com/v1).
 *
 * Why REST and not the hosted MCP server (https://mcp.supabase.com/mcp): the MCP server authenticates
 * with OAuth 2.1 + dynamic client registration or a PAT header and wraps the same Management API.
 * Calling the REST endpoints directly from our server gives the same capabilities with per-user tokens,
 * no extra MCP session/transport layer, and lets us enforce approvals per call before anything is sent.
 *
 * Auth: a personal access token (validated with GET /v1/projects), or OAuth when the server owner has
 * registered a Supabase OAuth app (SUPABASE_OAUTH_CLIENT_ID / SUPABASE_OAUTH_CLIENT_SECRET).
 */
const API = "https://api.supabase.com/v1";
const ref = z.string().regex(/^[a-z]{20}$/, "Project ref is the 20-letter id in the project URL").describe("Project ref (20 lowercase letters), from list_projects");

const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}`, ...(init.headers as Record<string, string> | undefined) } });

const LIST_TABLES_SQL = (schemas: string[]) => `
select n.nspname as schema, c.relname as name, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  greatest(c.reltuples, 0)::bigint as estimated_rows
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in (${schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")})
order by 1, 2 limit 500;`;

export const supabase = defineConnector({
  id: "supabase",
  name: "Supabase",
  icon: "⚡",
  description: "Query and change your Supabase databases, apply migrations and deploy Edge Functions.",
  auth: "api_key",
  scopes: ["projects:read", "database:read", "database:write", "edge_functions:write"],
  capabilities: [
    "List your projects and get a project's URL",
    "List tables and run SQL (read queries run read-only)",
    "Apply migrations",
    "Deploy Edge Functions (asks you first)",
    "DROP / DELETE / TRUNCATE / UPDATE / ALTER statements always wait for your approval",
  ],
  permissions: [
    "Uses a Supabase personal access token (or OAuth) that can reach the projects you allow when you create it.",
    "Create a scoped token: Projects (account-wide) Read, Project Settings Read, Database Read-write, Migrations Read-write, Edge Functions Read-write.",
    "The token is encrypted on TARGET's server and never shown again. Delete it in Supabase → Account → Access tokens to cut access completely.",
  ],
  requiredEnv: [],
  apiKey: {
    label: "Supabase personal access token",
    placeholder: "sbp_…",
    helpUrl: "https://supabase.com/dashboard/account/tokens",
    helpText: "Supabase Dashboard → Account → Access tokens → Generate new token. Scope it to the projects TARGET may use.",
    async validate(key, f) {
      if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(key)) throw new ConnectorError("That doesn't look like a Supabase personal access token (it starts with sbp_).", 400, "invalid");
      try {
        const projects = await apiFetch<{ name: string }[]>(`${API}/projects`, { f, headers: { Authorization: `Bearer ${key}` } });
        const n = Array.isArray(projects) ? projects.length : 0;
        return { accountLabel: `${n} project${n === 1 ? "" : "s"} reachable` };
      } catch (e) {
        if (e instanceof ConnectorError && e.code === "auth") throw new ConnectorError("Supabase rejected that token, or it lacks the “Projects (account-wide) Read” permission.", 400, "invalid");
        throw e;
      }
    },
  },
  oauth: {
    authorizeUrl: `${API}/oauth/authorize`,
    tokenUrl: `${API}/oauth/token`,
    clientIdEnv: "SUPABASE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SUPABASE_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    pkce: true,
    refreshable: true,
    async revoke(creds, env, f) {
      if (!creds.refresh_token || !env.SUPABASE_OAUTH_CLIENT_ID) return;
      await apiFetch(`${API}/oauth/revoke`, { method: "POST", f, body: { client_id: env.SUPABASE_OAUTH_CLIENT_ID, client_secret: env.SUPABASE_OAUTH_CLIENT_SECRET, refresh_token: creds.refresh_token } }).catch(() => undefined);
    },
  },
  docs: [
    "https://supabase.com/docs/reference/api/introduction",
    "https://api.supabase.com/api/v1-json",
    "https://supabase.com/docs/guides/platform/personal-access-tokens",
    "https://supabase.com/docs/guides/getting-started/mcp",
  ],
  todo: ["Supabase OAuth requires the server owner to register an OAuth app (Org settings → OAuth Apps); scopes are chosen there, not at authorize time."],
  getTools: () => [
    tool({
      name: "list_projects",
      description: "List the Supabase projects this connection can reach (ref, name, region, status).",
      input: z.object({}),
      async execute(_a, ctx) {
        const ps = await call<Record<string, unknown>[]>(ctx, "/projects");
        return (Array.isArray(ps) ? ps : []).map((p) => ({ ref: p.id ?? p.ref, name: p.name, region: p.region, status: p.status, organization_id: p.organization_id }));
      },
    }),
    tool({
      name: "get_project_url",
      description: "Get the API URL of a Supabase project.",
      input: z.object({ project_ref: ref }),
      async execute(a, ctx) {
        const p = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}`);
        return { ref: a.project_ref, name: p.name, url: `https://${a.project_ref}.supabase.co`, status: p.status };
      },
    }),
    tool({
      name: "list_tables",
      description: "List tables (with column count and whether row level security is on) in the given schemas.",
      input: z.object({ project_ref: ref, schemas: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/)).max(10).default(["public"]) }),
      async execute(a, ctx) {
        return call(ctx, `/projects/${a.project_ref}/database/query/read-only`, { method: "POST", body: { query: LIST_TABLES_SQL(a.schemas) } });
      },
    }),
    tool({
      name: "run_sql",
      description: "Run SQL on a Supabase project's Postgres database. Plain reads run in read-only mode. DROP/DELETE/TRUNCATE/UPDATE/ALTER/GRANT and dynamic SQL require the user's approval first.",
      input: z.object({ project_ref: ref, query: z.string().min(1).max(20000) }),
      requiresApproval: (a) => isDestructiveSql(a.query),
      summarize: (a) => `Run SQL on Supabase project ${a.project_ref}`,
      async execute(a, ctx) {
        const readOnly = isReadOnlySql(a.query);
        const path = readOnly ? `/projects/${a.project_ref}/database/query/read-only` : `/projects/${a.project_ref}/database/query`;
        const rows = await call(ctx, path, { method: "POST", body: { query: a.query } });
        return { read_only: readOnly, result: rows };
      },
    }),
    tool({
      name: "apply_migration",
      description: "Apply a named SQL migration to a Supabase project (recorded in its migration history). Destructive SQL requires approval.",
      input: z.object({ project_ref: ref, name: z.string().regex(/^[a-z0-9_]{1,100}$/, "snake_case name"), query: z.string().min(1).max(50000) }),
      requiresApproval: (a) => isDestructiveSql(a.query),
      summarize: (a) => `Apply migration “${a.name}” to Supabase project ${a.project_ref}`,
      async execute(a, ctx) {
        await call(ctx, `/projects/${a.project_ref}/database/migrations`, { method: "POST", body: { name: a.name, query: a.query }, headers: { "Idempotency-Key": `${a.project_ref}-${a.name}` } });
        return { applied: a.name };
      },
    }),
    tool({
      name: "deploy_edge_function",
      description: "Deploy (create or update) an Edge Function. This publishes code to the project's live endpoint, so it always requires approval.",
      input: z.object({
        project_ref: ref,
        slug: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,62}$/),
        entrypoint_path: z.string().max(200).default("index.ts"),
        verify_jwt: z.boolean().default(true),
        files: z.array(z.object({ name: z.string().min(1).max(200), content: z.string().max(200000) })).min(1).max(20),
      }),
      requiresApproval: true,
      summarize: (a) => `Deploy Edge Function “${a.slug}” to Supabase project ${a.project_ref}`,
      async execute(a, ctx) {
        const form = new FormData();
        form.append("metadata", JSON.stringify({ entrypoint_path: a.entrypoint_path, verify_jwt: a.verify_jwt, name: a.slug }));
        for (const file of a.files) form.append("file", new Blob([file.content], { type: "application/typescript" }), file.name);
        const r = await call<Record<string, unknown>>(ctx, `/projects/${a.project_ref}/functions/deploy?slug=${encodeURIComponent(a.slug)}`, { method: "POST", body: form, timeoutMs: 45000 });
        return { slug: r.slug, version: r.version, status: r.status, url: `https://${a.project_ref}.supabase.co/functions/v1/${a.slug}` };
      },
    }),
  ],
});
