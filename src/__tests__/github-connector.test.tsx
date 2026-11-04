/**
 * GitHub connector: complete repo management. Destructive / outward tools become approval cards (never run from
 * the chat path), the card shows server-looked-up details, and a token missing a newer scope (delete_repo,
 * workflow) returns "Reconnect GitHub to allow this" instead of a generic error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { connectorViews, getConnector } from "@/lib/connectors/registry";
import { executeToolCall, loadToolsForUser, toOpenAITools, toolsPrompt } from "@/lib/connectors/loadTools";
import { missingGithubScope } from "@/lib/connectors/github";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { decideApproval } from "@/lib/server/approvals";
import ApprovalCard from "@/components/ApprovalCard";
import type { Db } from "@/lib/server/auth";
import type { Approval } from "@/lib/approvals";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", GITHUB_OAUTH_CLIENT_ID: "gh-client", GITHUB_OAUTH_CLIENT_SECRET: "gh-secret-value" };
const TOKEN = "gho_" + "t".repeat(36);
const FULL = "repo, delete_repo, workflow";
const saved: Record<string, string | undefined> = {};

const ghConn = (scopes = ["repo", "delete_repo", "workflow"]) => ({
  id: "gh-conn", user_id: A, connector_id: "github", status: "connected", scopes, account_label: "@apihandle",
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKEN }), parseKey(KEY)), created_at: "2026-11-04T00:00:00Z", last_used_at: null,
});
const ctxOf = (f: typeof fetch) => ({ db: h.db as unknown as Db, userId: A, projectId: null, conversationId: null, taskId: null, f });

type Route = { status?: number; body?: unknown; scopes?: string | null; accepted?: string };
/** A fake api.github.com: key "METHOD /path" → response. Records every call. */
function github(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: u.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${method} ${u.pathname}`] ?? { status: 404, body: { message: "Not Found" } };
    const headers = new Headers({ "Content-Type": "application/json" });
    const scopes = r.scopes === undefined ? FULL : r.scopes;
    if (scopes !== null) headers.set("x-oauth-scopes", scopes);
    if (r.accepted !== undefined) headers.set("x-accepted-oauth-scopes", r.accepted);
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status, headers });
  });
  return { f: f as unknown as typeof fetch, calls };
}
type ApRow = { id: string; summary: string; status: string; payload: { tool: string; preview: { details: Record<string, string>; warning: string } } };
const aps = () => h.db.tables.approval_requests as unknown as ApRow[];
const repo = (full: string, extra: Record<string, unknown> = {}) => ({ full_name: full, private: true, default_branch: "main", archived: false, pushed_at: "2026-10-01T10:00:00Z", stargazers_count: 2, forks_count: 0, ...extra });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [ghConn()], tasks: [], approval_requests: [], activity_events: [] });
  h.db.as(A);
  resetMemoryLimits();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  cleanup();
});

const NEW_TOOLS = [
  "get_repo", "delete_repo", "archive_repo", "rename_repo", "set_repo_visibility", "update_repo",
  "put_file", "delete_file", "list_branches", "delete_branch", "list_pull_requests", "merge_pull_request",
  "list_issues", "set_issue_state", "list_releases", "create_release", "delete_release",
  "list_collaborators", "add_collaborator", "remove_collaborator", "list_workflows", "list_workflow_runs", "trigger_workflow",
];

describe("GitHub tool registry", () => {
  it("offers the full set of repo management tools to the model, and asks for delete_repo + workflow scopes", async () => {
    const gh = getConnector("github")!;
    expect(gh.scopes).toEqual(["repo", "delete_repo", "workflow"]);
    const { tools, connected } = await loadToolsForUser(A, h.db as unknown as Db);
    const names = toOpenAITools(tools, connected).map((s) => s.function.name);
    for (const t of [...NEW_TOOLS, "list_repos", "read_file", "create_repo", "create_branch", "commit_files", "open_pull_request"]) expect(names).toContain(`github__${t}`);
    expect(toolsPrompt(tools, connected)).toMatch(/never tell the user to do it manually/i);
    expect(toolsPrompt(tools, connected)).toContain("github__delete_repo");
  });

  it("marks every destructive or outward tool as needing approval, and leaves safe ones direct", () => {
    const tools = getConnector("github")!.getTools({ connector_id: "github", status: "connected", scopes: [], account_label: "" });
    const needs = (name: string, args: Record<string, unknown> = {}) => { const t = tools.find((x) => x.name === name)!; return typeof t.requiresApproval === "function" ? t.requiresApproval(args as never) : !!t.requiresApproval; };
    for (const t of ["delete_repo", "set_repo_visibility", "delete_branch", "merge_pull_request", "add_collaborator", "remove_collaborator", "delete_file", "delete_release", "trigger_workflow"]) expect(needs(t), t).toBe(true);
    expect(needs("archive_repo", { archived: true })).toBe(true);
    expect(needs("archive_repo", { archived: false })).toBe(false);
    expect(needs("put_file", { branch: "main" })).toBe(true);
    expect(needs("put_file", {})).toBe(true); // default branch
    expect(needs("put_file", { branch: "feature/x" })).toBe(false);
    expect(needs("create_release", { draft: false })).toBe(true);
    expect(needs("create_release", { draft: true })).toBe(false);
    for (const t of ["rename_repo", "update_repo", "set_issue_state", "list_repos", "get_repo", "list_workflow_runs", "create_branch"]) expect(needs(t), t).toBe(false);
  });

  it("rejects names that would change the URL path", async () => {
    const { f, calls } = github({});
    const r = await executeToolCall(ctxOf(f), "github__get_repo", JSON.stringify({ owner: "..", repo: "x" }));
    expect(JSON.parse(r.content).error).toBe("invalid_arguments");
    const p = await executeToolCall(ctxOf(f), "github__read_file", JSON.stringify({ owner: "a", repo: "b", path: "../../user" }));
    expect(JSON.parse(p.content).error).toBe("invalid_arguments");
    expect(calls).toHaveLength(0);
  });
});

describe("destructive GitHub tools create an approval instead of executing", () => {
  it("delete_repo: only a read happens; the card shows owner/name, visibility and a warning; approve deletes exactly once", async () => {
    const { f, calls } = github({ "GET /repos/apihandle/tmp": { body: repo("apihandle/tmp") }, "DELETE /repos/apihandle/tmp": { status: 204 } });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "github__delete_repo", JSON.stringify({ owner: "apihandle", repo: "tmp" }));
    expect(r.kind).toBe("approval");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    const ap = aps()[0];
    expect(ap).toMatchObject({ status: "pending", action_type: "connector_tool", summary: "Delete private repository apihandle/tmp", payload: { connector: "github", tool: "delete_repo", args: { owner: "apihandle", repo: "tmp" } } });
    expect(ap.payload.preview.details).toMatchObject({ Repository: "apihandle/tmp", Visibility: "Private" });
    expect(ap.payload.preview.warning).toMatch(/PERMANENTLY deletes/);
    expect(h.db.tables.tasks[0]).toMatchObject({ status: "waiting_approval" });

    const ok = await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(ok.status).toBe(200);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/repos/apihandle/tmp"]);
    expect(h.db.tables.approval_requests[0].status).toBe("executed");
  });

  it("delete_repo with several repos: one card lists them all, approve deletes each", async () => {
    const { f, calls } = github({
      "GET /repos/apihandle/a": { body: repo("apihandle/a") }, "GET /repos/apihandle/b": { body: repo("apihandle/b", { private: false }) },
      "DELETE /repos/apihandle/a": { status: 204 }, "DELETE /repos/apihandle/b": { status: 204 },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "github__delete_repo", JSON.stringify({ repos: [{ owner: "apihandle", repo: "a" }, { owner: "apihandle", repo: "b" }] }));
    expect(r.kind).toBe("approval");
    expect(h.db.tables.approval_requests).toHaveLength(1);
    const ap = aps()[0];
    expect(ap.summary).toBe("Delete 2 GitHub repositories");
    expect(ap.payload.preview.details.Count).toBe("2 (1 private, 1 public)");
    await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/repos/apihandle/a", "/repos/apihandle/b"]);
  });

  it("merge, visibility, branch delete and collaborator changes pause for approval without writing", async () => {
    const { f, calls } = github({
      "GET /repos/o/r": { body: repo("o/r") },
      "GET /repos/o/r/pulls/7": { body: { state: "open", draft: false, title: "Fix", head: { ref: "fix" }, base: { ref: "main" }, mergeable: true } },
      "GET /repos/o/r/branches/old": { body: { name: "old", commit: { sha: "abcdef1234" } } },
    });
    const cases: [string, Record<string, unknown>][] = [
      ["merge_pull_request", { owner: "o", repo: "r", number: 7 }],
      ["set_repo_visibility", { owner: "o", repo: "r", private: false }],
      ["delete_branch", { owner: "o", repo: "r", branch: "old" }],
      ["add_collaborator", { owner: "o", repo: "r", username: "friend" }],
      ["remove_collaborator", { owner: "o", repo: "r", username: "friend" }],
      ["trigger_workflow", { owner: "o", repo: "r", workflow: "deploy.yml" }],
    ];
    for (const [t, args] of cases) expect((await executeToolCall(ctxOf(f), `github__${t}`, JSON.stringify(args))).kind, t).toBe("approval");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(h.db.tables.approval_requests).toHaveLength(cases.length);
    const vis = aps().find((a) => a.payload.tool === "set_repo_visibility")!;
    expect(vis.payload.preview.details.Change).toBe("Private → Public");
    expect(vis.payload.preview.warning).toMatch(/anyone on the internet/);
  });

  it("refuses up front (no card) when the action can't work: deleting the default branch", async () => {
    const { f } = github({ "GET /repos/o/r": { body: repo("o/r") } });
    const r = await executeToolCall(ctxOf(f), "github__delete_branch", JSON.stringify({ owner: "o", repo: "r", branch: "main" }));
    expect(r.kind).toBe("error");
    expect(JSON.parse(r.content).message).toMatch(/default branch/);
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });

  it("safe tools run directly (rename, close an issue)", async () => {
    const { f, calls } = github({
      "PATCH /repos/o/r": { body: repo("o/r2") },
      "PATCH /repos/o/r/issues/3": { body: { number: 3, state: "closed" } },
    });
    expect((await executeToolCall(ctxOf(f), "github__rename_repo", JSON.stringify({ owner: "o", repo: "r", new_name: "r2" }))).kind).toBe("result");
    expect((await executeToolCall(ctxOf(f), "github__set_issue_state", JSON.stringify({ owner: "o", repo: "r", number: 3, state: "closed" }))).kind).toBe("result");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["PATCH /repos/o/r", "PATCH /repos/o/r/issues/3"]);
    expect(calls[0].body).toEqual({ name: "r2" });
    expect(h.db.tables.approval_requests).toHaveLength(0);
  });
});

describe("missing scope → Reconnect GitHub", () => {
  it("delete_repo with a token that only has `repo`: reconnect pause with a link, no approval card, nothing deleted", async () => {
    h.db.tables.connections = [ghConn(["repo"])];
    const { f, calls } = github({ "GET /repos/apihandle/tmp": { body: repo("apihandle/tmp"), scopes: "repo" } });
    const r = await executeToolCall(ctxOf(f), "github__delete_repo", JSON.stringify({ owner: "apihandle", repo: "tmp" }));
    expect(r).toMatchObject({ kind: "needs_connection", connector: "github", status: "missing_scope" });
    const body = JSON.parse(r.content);
    expect(body).toMatchObject({ error: "reconnect_required", missing_scope: "delete_repo", reconnect_url: "/app/connectors?connect=github" });
    expect(body.message).toMatch(/^Reconnect GitHub to allow this/);
    expect(h.db.tables.approval_requests).toHaveLength(0);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a GitHub App / fine-grained token (empty x-oauth-scopes) is not treated as missing delete_repo", async () => {
    const { f } = github({ "GET /repos/o/r": { body: repo("o/r"), scopes: "" } });
    expect((await executeToolCall(ctxOf(f), "github__delete_repo", JSON.stringify({ owner: "o", repo: "r" }))).kind).toBe("approval");
  });

  it("an approved delete that GitHub refuses for scope fails with the reconnect message (card shows a Reconnect link)", async () => {
    const { f } = github({
      "GET /repos/o/r": { body: repo("o/r"), scopes: null }, // GitHub didn't say, so the card is created
      "DELETE /repos/o/r": { status: 403, body: { message: "Must have admin rights to Repository." }, scopes: "repo", accepted: "delete_repo" },
    });
    vi.stubGlobal("fetch", f);
    await executeToolCall(ctxOf(f), "github__delete_repo", JSON.stringify({ owner: "o", repo: "r" }));
    const ap = aps()[0];
    const res = await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    expect(res.status).toBe(502);
    expect(String(res.body.error)).toMatch(/^Reconnect GitHub to allow this/);
    expect(String(res.body.error)).toContain("delete_repo");
    render(<ApprovalCard id={ap.id} initial={aps()[0] as unknown as Approval} />);
    expect(screen.getByTestId("approval-reconnect").getAttribute("href")).toBe("/app/connectors?connect=github");
  });

  it("detects the workflow scope from GitHub's message, and ignores tokens whose scopes GitHub doesn't report", () => {
    const hd = (o: Record<string, string>) => new Headers(o);
    expect(missingGithubScope(404, hd({}), "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope")).toBe("workflow");
    expect(missingGithubScope(403, hd({ "x-oauth-scopes": "repo", "x-accepted-oauth-scopes": "delete_repo" }), "Must have admin rights")).toBe("delete_repo");
    expect(missingGithubScope(403, hd({ "x-oauth-scopes": "repo, delete_repo", "x-accepted-oauth-scopes": "delete_repo" }), "Must have admin rights")).toBeNull(); // really not an admin
    expect(missingGithubScope(404, hd({ "x-oauth-scopes": "repo", "x-accepted-oauth-scopes": "repo" }), "Not Found")).toBeNull();
    expect(missingGithubScope(403, hd({}), "Resource not accessible by integration", "delete_repo")).toBeNull();
    expect(missingGithubScope(403, hd({ "x-oauth-scopes": "" }), "Resource not accessible by integration", "delete_repo")).toBeNull(); // GitHub App token
  });

  it("the Connectors page offers Reconnect to connections made before delete_repo/workflow were added", () => {
    const old = connectorViews(ENV, [{ connector_id: "github", status: "connected", scopes: ["repo"], account_label: "@a" }]).find((v) => v.id === "github")!;
    expect(old.needsReconnect).toEqual(["delete_repo", "workflow"]);
    const fresh = connectorViews(ENV, [{ connector_id: "github", status: "connected", scopes: ["repo", "delete_repo", "workflow"], account_label: "@a" }]).find((v) => v.id === "github")!;
    expect(fresh.needsReconnect).toBeUndefined();
  });
});

describe("approval card for a repo delete", () => {
  it("shows the repository, visibility and the warning, not raw JSON", () => {
    const a = {
      id: "33333333-3333-4333-8333-333333333333", action_type: "connector_tool", summary: "Delete private repository apihandle/tmp", destination: "GitHub (@apihandle)",
      payload: { connector: "github", tool: "delete_repo", args: { owner: "apihandle", repo: "tmp" }, preview: { details: { Repository: "apihandle/tmp", Visibility: "Private" }, warning: "This PERMANENTLY deletes this repository." } },
      status: "pending", project_id: null, conversation_id: null, task_id: null, decided_at: null, executed_at: null, result: null, error: null, created_at: "2026-11-04T00:00:00Z",
    } as Approval;
    render(<ApprovalCard id={a.id} initial={a} />);
    expect(screen.getByText("apihandle/tmp")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByTestId("approval-warning").textContent).toMatch(/PERMANENTLY deletes/);
    expect(screen.getByTestId("approve-btn").textContent).toBe("Approve & delete");
    expect(screen.queryByText(/"owner"/)).toBeNull();
  });
});
