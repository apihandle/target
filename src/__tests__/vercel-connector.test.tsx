/**
 * Vercel connector: complete project management. Production-affecting and destructive tools (promote, rollback,
 * production redeploy, delete project / env var, remove domain, build settings, git link) become approval cards with
 * server-looked-up details; env var values are never shown; a permission 403 returns "Reconnect Vercel".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { executeToolCall, loadToolsForUser, toOpenAITools } from "@/lib/connectors/loadTools";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { decideApproval } from "@/lib/server/approvals";
import type { Db } from "@/lib/server/auth";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", VERCEL_OAUTH_CLIENT_ID: "v-client", VERCEL_OAUTH_CLIENT_SECRET: "v-secret-value", VERCEL_INTEGRATION_SLUG: "target" };
const TOKEN = "vca_" + "t".repeat(30);
const saved: Record<string, string | undefined> = {};

const vConn = () => ({
  id: "v-conn", user_id: A, connector_id: "vercel", status: "connected", scopes: [], account_label: "@apihandle",
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKEN, meta: { teamId: "team_abc" } }), parseKey(KEY)), meta: { teamId: "team_abc" }, created_at: "2026-11-04T00:00:00Z", last_used_at: null,
});
const ctxOf = (f: typeof fetch) => ({ db: h.db as unknown as Db, userId: A, projectId: null, conversationId: null, taskId: null, f });

type Route = { status?: number; body?: unknown };
function vercelApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; search: URLSearchParams; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: u.pathname, search: u.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${method} ${u.pathname}`] ?? { status: 404, body: { error: { message: "Not Found" } } };
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status, headers: { "Content-Type": "application/json" } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
type ApRow = { id: string; summary: string; payload: { tool: string; preview: { details: Record<string, string>; warning: string } } };
const aps = () => h.db.tables.approval_requests as unknown as ApRow[];
const PRJ = { id: "prj_1", name: "shop", framework: "nextjs", buildCommand: null, nodeVersion: "22.x", link: { type: "github", org: "o", repo: "shop", productionBranch: "main" }, targets: { production: { id: "dpl_live", url: "shop-live.vercel.app", createdAt: 1793761700197 } } };
const dep = (id: string, target: string | null, extra: Record<string, unknown> = {}) => ({ id, uid: id, name: "shop", url: `${id}.vercel.app`, readyState: "READY", target, projectId: "prj_1", createdAt: 1793761700197, meta: { githubCommitSha: "abcdef1234567", githubCommitMessage: "Fix\nbody", githubCommitRef: "main" }, ...extra });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [vConn()], tasks: [], approval_requests: [], activity_events: [] });
  h.db.as(A);
  resetMemoryLimits();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const ALL_TOOLS = [
  "list_teams", "list_projects", "get_project", "create_project", "update_project", "link_git_repo", "delete_project",
  "list_deployments", "create_deployment", "redeploy", "promote_deployment", "rollback_deployment", "cancel_deployment", "get_deployment", "get_deployment_logs",
  "list_env_vars", "add_env_var", "update_env_var", "delete_env_var", "list_domains", "add_domain", "remove_domain", "check_domain",
];

describe("Vercel tool registry", () => {
  it("offers the full management tool set to the model", async () => {
    const { tools, connected } = await loadToolsForUser(A, h.db as unknown as Db);
    const names = toOpenAITools(tools, connected).map((s) => s.function.name);
    for (const t of ALL_TOOLS) expect(names).toContain(`vercel__${t}`);
  });

  it("approval for production / destructive tools; direct for safe ones", () => {
    const tools = getConnector("vercel")!.getTools({ connector_id: "vercel", status: "connected", scopes: [], account_label: "" });
    const needs = (name: string, args: Record<string, unknown> = {}) => { const t = tools.find((x) => x.name === name)!; return typeof t.requiresApproval === "function" ? t.requiresApproval(args as never) : !!t.requiresApproval; };
    for (const t of ["delete_project", "promote_deployment", "rollback_deployment", "delete_env_var", "remove_domain", "add_domain", "update_project", "link_git_repo"]) expect(needs(t), t).toBe(true);
    expect(needs("redeploy", { target: "production" })).toBe(true);
    expect(needs("redeploy", { target: "preview" })).toBe(false);
    for (const t of ["list_teams", "list_projects", "get_project", "create_project", "list_deployments", "cancel_deployment", "list_env_vars", "add_env_var", "update_env_var", "list_domains", "check_domain"]) expect(needs(t), t).toBe(false);
  });
});

describe("env var values never reach the chat", () => {
  it("list_env_vars hides values (even plain and encrypted ciphertext) and never asks Vercel to decrypt", async () => {
    const { f, calls } = vercelApi({ "GET /v10/projects/shop/env": { body: { envs: [
      { id: "e1", key: "DATABASE_URL", type: "encrypted", value: "ciphertext-AAAA", target: ["production"] },
      { id: "e2", key: "PUBLIC_FLAG", type: "plain", value: "plain-value-visible", target: ["preview"] },
    ] } } });
    const r = await executeToolCall(ctxOf(f), "vercel__list_env_vars", JSON.stringify({ project: "shop" }));
    expect(r.kind).toBe("result");
    expect(r.content).toContain("DATABASE_URL");
    expect(r.content).not.toContain("ciphertext-AAAA");
    expect(r.content).not.toContain("plain-value-visible");
    expect(calls[0].search.get("decrypt")).toBeNull();
    expect(calls[0].search.get("teamId")).toBe("team_abc");
  });

  it("add_env_var sends the value but the result doesn't echo it", async () => {
    const { f, calls } = vercelApi({ "POST /v10/projects/shop/env": { status: 201, body: { created: { id: "e9", key: "API_KEY", type: "encrypted", value: "s3cr3t-value-777", target: ["production"] } } } });
    const r = await executeToolCall(ctxOf(f), "vercel__add_env_var", JSON.stringify({ project: "shop", key: "API_KEY", value: "s3cr3t-value-777", targets: ["production"] }));
    expect(r.kind).toBe("result");
    expect(r.content).not.toContain("s3cr3t-value-777");
    expect(calls[0].body).toMatchObject({ key: "API_KEY", value: "s3cr3t-value-777", type: "encrypted", target: ["production"] });
  });

  it("delete_env_var: card shows the key and targets (no value); approve deletes once", async () => {
    const { f, calls } = vercelApi({
      "GET /v10/projects/shop/env": { body: { envs: [{ id: "e1", key: "DATABASE_URL", type: "encrypted", value: "ciphertext-AAAA", target: ["production", "preview"] }] } },
      "DELETE /v9/projects/shop/env/e1": { body: {} },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "vercel__delete_env_var", JSON.stringify({ project: "shop", id: "e1" }));
    expect(r.kind).toBe("approval");
    const ap = aps()[0];
    expect(ap.summary).toBe("Delete DATABASE_URL from Vercel project shop");
    expect(ap.payload.preview.details).toMatchObject({ Variable: "DATABASE_URL", Targets: "production, preview", Value: "(hidden)" });
    expect(JSON.stringify(ap)).not.toContain("ciphertext-AAAA");
    expect(ap.payload.preview.warning).toMatch(/production/);
    await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/v9/projects/shop/env/e1"]);
  });
});

describe("production changes pause for approval", () => {
  it("promote_deployment: reads only; card shows the deployment and what is live; approve calls promote once", async () => {
    const { f, calls } = vercelApi({
      "GET /v9/projects/shop": { body: PRJ }, "GET /v13/deployments/dpl_new": { body: dep("dpl_new", null) },
      "POST /v10/projects/prj_1/promote/dpl_new": { status: 201, body: {} },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "vercel__promote_deployment", JSON.stringify({ project: "shop", deployment_id: "dpl_new" }));
    expect(r.kind).toBe("approval");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    const ap = aps()[0];
    expect(ap.payload.preview.details).toMatchObject({ Deployment: "dpl_new", "Currently live": "https://shop-live.vercel.app (dpl_live)", Commit: "abcdef1 Fix" });
    await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/v10/projects/prj_1/promote/dpl_new"]);
  });

  it("rollback refuses up front (no card) for a preview deployment", async () => {
    const { f } = vercelApi({ "GET /v9/projects/shop": { body: PRJ }, "GET /v13/deployments/dpl_prev": { body: dep("dpl_prev", null) } });
    const r = await executeToolCall(ctxOf(f), "vercel__rollback_deployment", JSON.stringify({ project: "shop", deployment_id: "dpl_prev" }));
    expect(r.kind).toBe("error");
    expect(JSON.parse(r.content).message).toMatch(/previous production deployment/);
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });

  it("delete_project card lists repository, domains and production URL", async () => {
    const { f, calls } = vercelApi({ "GET /v9/projects/shop": { body: PRJ }, "GET /v9/projects/prj_1/domains": { body: { domains: [{ name: "shop.com" }, { name: "www.shop.com" }] } } });
    const r = await executeToolCall(ctxOf(f), "vercel__delete_project", JSON.stringify({ project: "shop" }));
    expect(r.kind).toBe("approval");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(aps()[0].payload.preview.details).toMatchObject({ Repository: "github: o/shop", Domains: "shop.com\nwww.shop.com" });
    expect(aps()[0].payload.preview.warning).toMatch(/PERMANENTLY deletes/);
  });

  it("update_project card shows old → new build settings", async () => {
    const { f } = vercelApi({ "GET /v9/projects/shop": { body: PRJ } });
    await executeToolCall(ctxOf(f), "vercel__update_project", JSON.stringify({ project: "shop", buildCommand: "npm run build:prod", nodeVersion: "24.x" }));
    expect(aps()[0].payload.preview.details.Changes).toBe("buildCommand: (default) → npm run build:prod\nnodeVersion: 22.x → 24.x");
  });

  it("a preview redeploy and cancel run directly", async () => {
    const { f, calls } = vercelApi({
      "GET /v13/deployments/dpl_a": { body: dep("dpl_a", null) },
      "POST /v13/deployments": { body: { id: "dpl_b", url: "dpl_b.vercel.app", readyState: "QUEUED" } },
      "PATCH /v12/deployments/dpl_b/cancel": { body: { uid: "dpl_b", state: "CANCELED" } },
    });
    expect((await executeToolCall(ctxOf(f), "vercel__redeploy", JSON.stringify({ deployment_id: "dpl_a", target: "preview" }))).kind).toBe("result");
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "shop", deploymentId: "dpl_a" });
    expect((await executeToolCall(ctxOf(f), "vercel__cancel_deployment", JSON.stringify({ deployment_id: "dpl_b" }))).kind).toBe("result");
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });
});

describe("missing permission → Reconnect Vercel", () => {
  it("a permission 403 returns reconnect_required", async () => {
    const { f } = vercelApi({ "GET /v10/projects/shop/env": { status: 403, body: { error: { code: "forbidden", message: "Not authorized: missing permission" } } } });
    const r = await executeToolCall(ctxOf(f), "vercel__list_env_vars", JSON.stringify({ project: "shop" }));
    expect(r).toMatchObject({ kind: "needs_connection", connector: "vercel", status: "missing_scope" });
    expect(JSON.parse(r.content)).toMatchObject({ error: "reconnect_required", reconnect_url: "/app/connectors?connect=vercel" });
  });
});
