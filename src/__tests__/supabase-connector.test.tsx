/**
 * Supabase connector: complete project management. Destructive / production-affecting tools become approval cards
 * (never run from the chat path) with server-looked-up details, secrets never reach the chat, create_project is
 * free-tier only, and a 403 on a scope added after the user connected returns "Reconnect Supabase to allow this".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { connectorViews, getConnector } from "@/lib/connectors/registry";
import { executeToolCall, loadToolsForUser, toOpenAITools } from "@/lib/connectors/loadTools";
import { isSecretAuthField, logsSql, maskKey } from "@/lib/connectors/supabase";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { decideApproval } from "@/lib/server/approvals";
import type { Db } from "@/lib/server/auth";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 9).toString("base64");
const REF = "abcdefghijklmnopqrst";
const ENV = { CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_OAUTH_CLIENT_ID: "sb-client", SUPABASE_OAUTH_CLIENT_SECRET: "sb-secret-value" };
const TOKEN = "sbp_oauth_" + "t".repeat(30);
const SECRET_KEY = "sb_secret_" + "S".repeat(30) + "WXYZ";
const JWT_SERVICE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop1234";
const ALL = getConnector("supabase")!.scopes;
const saved: Record<string, string | undefined> = {};

const sbConn = (scopes = ALL) => ({
  id: "sb-conn", user_id: A, connector_id: "supabase", status: "connected", scopes, account_label: "Acme",
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKEN }), parseKey(KEY)), created_at: "2026-11-04T00:00:00Z", last_used_at: null,
});
const ctxOf = (f: typeof fetch) => ({ db: h.db as unknown as Db, userId: A, projectId: null, conversationId: null, taskId: null, f });

type Route = { status?: number; body?: unknown };
/** Fake api.supabase.com + <ref>.supabase.co: key "METHOD host/path" (host omitted for the Management API). */
function supa(routes: Record<string, Route>) {
  const calls: { method: string; host: string; path: string; search: string; body?: unknown; auth?: string | null }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    let body: unknown;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, host: u.host, path: u.pathname, search: u.search, body, auth: new Headers(init.headers as HeadersInit).get("authorization") });
    const key = u.host === "api.supabase.com" ? `${method} ${u.pathname}` : `${method} ${u.host}${u.pathname}`;
    const r = routes[key] ?? { status: 404, body: { message: "Not Found" } };
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
type ApRow = { id: string; summary: string; status: string; payload: { tool: string; args: Record<string, unknown>; preview: { details: Record<string, string>; warning: string } } };
const aps = () => h.db.tables.approval_requests as unknown as ApRow[];
const project = { id: REF, ref: REF, name: "shop", region: "ap-south-1", status: "ACTIVE_HEALTHY", created_at: "2026-10-01T10:00:00Z" };

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [sbConn()], tasks: [], approval_requests: [], activity_events: [] });
  h.db.as(A);
  resetMemoryLimits();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const ALL_TOOLS = [
  "list_organizations", "list_org_members", "list_projects", "get_project_url", "create_project", "pause_project", "restore_project", "delete_project",
  "list_tables", "run_sql", "list_migrations", "apply_migration", "generate_typescript_types", "list_branches",
  "list_edge_functions", "deploy_edge_function", "delete_edge_function",
  "list_api_keys", "get_api_key", "list_secrets", "set_secrets", "delete_secrets",
  "list_buckets", "create_bucket", "delete_bucket", "get_auth_config", "update_auth_config", "get_logs",
];

describe("Supabase tool registry", () => {
  it("offers the full management tool set to the model", async () => {
    const { tools, connected } = await loadToolsForUser(A, h.db as unknown as Db);
    const names = toOpenAITools(tools, connected).map((s) => s.function.name);
    for (const t of ALL_TOOLS) expect(names).toContain(`supabase__${t}`);
  });

  it("marks destructive / production-affecting tools as needing approval and leaves reads direct", () => {
    const tools = getConnector("supabase")!.getTools({ connector_id: "supabase", status: "connected", scopes: [], account_label: "" });
    const needs = (name: string, args: Record<string, unknown> = {}) => { const t = tools.find((x) => x.name === name)!; return typeof t.requiresApproval === "function" ? t.requiresApproval(args as never) : !!t.requiresApproval; };
    for (const t of ["create_project", "pause_project", "restore_project", "delete_project", "deploy_edge_function", "delete_edge_function", "delete_secrets", "delete_bucket", "update_auth_config"]) expect(needs(t), t).toBe(true);
    for (const q of ["DROP TABLE users", "delete from orders", "truncate logs", "alter table x add column y int"]) expect(needs("run_sql", { query: q }), q).toBe(true);
    expect(needs("run_sql", { query: "select 1" })).toBe(false);
    expect(needs("create_bucket", { public: true })).toBe(true);
    expect(needs("create_bucket", { public: false })).toBe(false);
    for (const t of ["list_projects", "list_api_keys", "list_secrets", "set_secrets", "list_buckets", "get_auth_config", "get_logs", "list_migrations", "generate_typescript_types", "list_edge_functions", "list_org_members"]) expect(needs(t), t).toBe(false);
  });

  it("existing connections (old scope list) are offered Reconnect for the added scopes", () => {
    const old = connectorViews(ENV, [{ connector_id: "supabase", status: "connected", scopes: ["projects:read", "database:read", "database:write", "edge_functions:write"], account_label: "Acme" }]).find((v) => v.id === "supabase")!;
    expect(old.needsReconnect).toEqual(expect.arrayContaining(["projects:write", "secrets:read", "auth:write", "analytics:read"]));
    const fresh = connectorViews(ENV, [{ connector_id: "supabase", status: "connected", scopes: ALL, account_label: "Acme" }]).find((v) => v.id === "supabase")!;
    expect(fresh.needsReconnect).toBeUndefined();
  });
});

describe("secrets never reach the chat", () => {
  it("list_api_keys masks secret keys completely (only the last 4) and shortens public ones", async () => {
    const { f } = supa({ [`GET /v1/projects/${REF}/api-keys`]: { body: [
      { id: "anon", name: "anon", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.publicpart1234" },
      { id: "service_role", name: "service_role", type: "legacy", api_key: JWT_SERVICE },
      { id: "k1", name: "default", type: "secret", api_key: SECRET_KEY },
      { id: "k2", name: "default", type: "publishable", api_key: "sb_publishable_abcdefghijk_lmnop" },
    ] } });
    const r = await executeToolCall(ctxOf(f), "supabase__list_api_keys", JSON.stringify({ project_ref: REF }));
    expect(r.kind).toBe("result");
    expect(r.content).not.toContain(SECRET_KEY);
    expect(r.content).not.toContain(JWT_SERVICE);
    expect(r.content).not.toContain("SSSSSSSS");
    expect(r.content).toContain("ends …WXYZ");
    expect(maskKey({ type: "publishable", api_key: "sb_publishable_abcdefghijk_lmnop" })).toBe("sb_publishable_abcde…mnop");
  });

  it("list_secrets never returns values; set_secrets doesn't echo them", async () => {
    const { f, calls } = supa({
      [`GET /v1/projects/${REF}/secrets`]: { body: [{ name: "OPENAI_API_KEY", value: "digest-should-not-show-123", updated_at: "2026-11-01" }] },
      [`POST /v1/projects/${REF}/secrets`]: { status: 201, body: {} },
    });
    const l = await executeToolCall(ctxOf(f), "supabase__list_secrets", JSON.stringify({ project_ref: REF }));
    expect(l.content).toContain("OPENAI_API_KEY");
    expect(l.content).not.toContain("digest-should-not-show");
    const s = await executeToolCall(ctxOf(f), "supabase__set_secrets", JSON.stringify({ project_ref: REF, secrets: [{ name: "STRIPE_KEY", value: "super-secret-value-999" }] }));
    expect(s.kind).toBe("result");
    expect(s.content).not.toContain("super-secret-value-999");
    expect(calls.at(-1)).toMatchObject({ method: "POST", body: [{ name: "STRIPE_KEY", value: "super-secret-value-999" }] });
  });

  it("rejects reserved SUPABASE_ secret names", async () => {
    const { f, calls } = supa({});
    const r = await executeToolCall(ctxOf(f), "supabase__set_secrets", JSON.stringify({ project_ref: REF, secrets: [{ name: "SUPABASE_URL", value: "x" }] }));
    expect(JSON.parse(r.content).error).toBe("invalid_arguments");
    expect(calls).toHaveLength(0);
  });

  it("get_auth_config hides provider secrets and SMTP passwords", async () => {
    const { f } = supa({ [`GET /v1/projects/${REF}/config/auth`]: { body: { site_url: "https://app.example", external_google_enabled: true, external_google_secret: "GOCSPX-real-secret", smtp_pass: "mail-pass-1", smtp_host: "smtp.example" } } });
    const r = await executeToolCall(ctxOf(f), "supabase__get_auth_config", JSON.stringify({ project_ref: REF, fields: ["site_url", "external_google_secret", "smtp_pass", "smtp_host"] }));
    expect(r.content).toContain("https://app.example");
    expect(r.content).not.toContain("GOCSPX-real-secret");
    expect(r.content).not.toContain("mail-pass-1");
    expect(isSecretAuthField("external_google_secret")).toBe(true);
    expect(isSecretAuthField("password_min_length")).toBe(false);
    expect(isSecretAuthField("hook_custom_access_token_secrets")).toBe(true);
  });

  it("create_bucket uses the project's secret key server-side only", async () => {
    const { f, calls } = supa({
      [`GET /v1/projects/${REF}/api-keys`]: { body: [{ id: "k1", name: "default", type: "secret", api_key: SECRET_KEY }] },
      [`POST ${REF}.supabase.co/storage/v1/bucket`]: { body: { name: "avatars" } },
    });
    const r = await executeToolCall(ctxOf(f), "supabase__create_bucket", JSON.stringify({ project_ref: REF, id: "avatars" }));
    expect(r.kind).toBe("result");
    expect(r.content).not.toContain(SECRET_KEY);
    expect(calls[0].search).toBe("?reveal=true");
    expect(calls[1]).toMatchObject({ method: "POST", host: `${REF}.supabase.co`, path: "/storage/v1/bucket", body: { id: "avatars", name: "avatars", public: false } });
    expect(calls[1].auth).toBe(`Bearer ${SECRET_KEY}`);
  });
});

describe("approval cards", () => {
  it("delete_project: only reads happen; the card names the project; approve deletes exactly once", async () => {
    const { f, calls } = supa({ [`GET /v1/projects/${REF}`]: { body: project }, [`DELETE /v1/projects/${REF}`]: { body: {} } });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "supabase__delete_project", JSON.stringify({ project_ref: REF }));
    expect(r.kind).toBe("approval");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    const ap = aps()[0];
    expect(ap.summary).toBe("Delete Supabase project shop");
    expect(ap.payload.preview.details.Project).toBe(`shop (${REF})`);
    expect(ap.payload.preview.warning).toMatch(/PERMANENTLY deletes/);
    const ok = await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(ok.status).toBe(200);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([`/v1/projects/${REF}`]);
  });

  it("warns when the project is TARGET's own database", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${REF}.supabase.co`;
    const { f } = supa({ [`GET /v1/projects/${REF}`]: { body: project } });
    await executeToolCall(ctxOf(f), "supabase__pause_project", JSON.stringify({ project_ref: REF }));
    expect(aps()[0].payload.preview.warning).toMatch(/TARGET itself runs on/);
  });

  it("destructive run_sql shows the SQL on the card and runs only after approval", async () => {
    const { f, calls } = supa({ [`POST /v1/projects/${REF}/database/query`]: { body: [] } });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "supabase__run_sql", JSON.stringify({ project_ref: REF, query: "DROP TABLE old_logs" }));
    expect(r.kind).toBe("approval");
    expect(aps()[0].payload.preview.details.SQL).toBe("DROP TABLE old_logs");
    expect(calls).toHaveLength(0); // nothing is sent to Supabase before the user decides
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    expect(calls.filter((c) => c.path.endsWith("/database/query"))).toHaveLength(1);
  });

  it("update_auth_config card shows old → new and masks secret values", async () => {
    const { f } = supa({ [`GET /v1/projects/${REF}/config/auth`]: { body: { site_url: "https://old.example", external_google_secret: "old-secret-abc" } } });
    const r = await executeToolCall(ctxOf(f), "supabase__update_auth_config", JSON.stringify({ project_ref: REF, changes: { site_url: "https://new.example", external_google_secret: "new-secret-xyz" } }));
    expect(r.kind).toBe("approval");
    const c = aps()[0].payload.preview.details.Changes;
    expect(c).toContain("site_url: https://old.example → https://new.example");
    expect(c).not.toContain("new-secret-xyz");
    expect(c).not.toContain("old-secret-abc");
  });

  it("delete_secrets refuses up front when none of the names exist", async () => {
    const { f } = supa({ [`GET /v1/projects/${REF}/secrets`]: { body: [{ name: "A" }] } });
    const r = await executeToolCall(ctxOf(f), "supabase__delete_secrets", JSON.stringify({ project_ref: REF, names: ["NOPE"] }));
    expect(r.kind).toBe("error");
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });
});

describe("create_project is free-tier only", () => {
  it("refuses a paid organization before any card is shown", async () => {
    const { f, calls } = supa({ "GET /v1/organizations/acme": { body: { id: "acme", slug: "acme", name: "Acme", plan: "pro" } } });
    const r = await executeToolCall(ctxOf(f), "supabase__create_project", JSON.stringify({ name: "new", organization_slug: "acme" }));
    expect(r.kind).toBe("error");
    expect(JSON.parse(r.content).message).toMatch(/only creates free-tier projects/);
    expect(h.db.tables.approval_requests).toHaveLength(0);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("free organization: card, then POST with plan free and a generated password that is not returned", async () => {
    const { f, calls } = supa({
      "GET /v1/organizations/acme": { body: { id: "acme", slug: "acme", name: "Acme", plan: "free" } },
      "POST /v1/projects": { status: 201, body: { id: "zyxwvutsrqponmlkjihg", ref: "zyxwvutsrqponmlkjihg", name: "new", region: "ap-south-1", status: "COMING_UP" } },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "supabase__create_project", JSON.stringify({ name: "new", organization_slug: "acme" }));
    expect(r.kind).toBe("approval");
    expect(aps()[0].payload.preview.details.Plan).toMatch(/Free/);
    const res = await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    expect(res.status).toBe(200);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "new", organization_slug: "acme", plan: "free", region: "ap-south-1" });
    const pass = (post.body as { db_pass: string }).db_pass;
    expect(pass.length).toBeGreaterThanOrEqual(30);
    expect(JSON.stringify(h.db.tables.approval_requests[0])).not.toContain(pass);
  });
});

describe("missing scope → Reconnect Supabase", () => {
  it("a 403 on a newly added scope returns reconnect_required with the link", async () => {
    const { f } = supa({ [`GET /v1/projects/${REF}/secrets`]: { status: 403, body: { message: "Forbidden" } } });
    const r = await executeToolCall(ctxOf(f), "supabase__list_secrets", JSON.stringify({ project_ref: REF }));
    expect(r).toMatchObject({ kind: "needs_connection", connector: "supabase", status: "missing_scope" });
    expect(JSON.parse(r.content)).toMatchObject({ error: "reconnect_required", missing_scope: "secrets:read", reconnect_url: "/app/connectors?connect=supabase" });
  });

  it("a 403 on an original scope is a plain error (role problem), not a reconnect loop", async () => {
    const { f } = supa({ ["GET /v1/projects"]: { status: 403, body: { message: "Forbidden" } } });
    const r = await executeToolCall(ctxOf(f), "supabase__list_projects", "{}");
    expect(r.kind).toBe("error");
    expect(JSON.parse(r.content).message).toMatch(/role/);
  });
});

describe("logs", () => {
  it("builds escaped ClickHouse SQL for the unified log stream", () => {
    expect(logsSql({ source: "postgres_logs", search: "it's", limit: 5 })).toBe("select timestamp, source, event_message from logs where source = 'postgres_logs' and positionCaseInsensitive(event_message, 'it\\'s') > 0 order by timestamp desc limit 5");
    expect(logsSql({ limit: 1 })).toBe("select timestamp, source, event_message from logs order by timestamp desc limit 1");
  });
});
