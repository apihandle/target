import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError, MissingScopeError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * GitHub, via the REST API with an OAuth App user token (https://docs.github.com/en/rest).
 *
 * Scopes: `repo` (code, issues, PRs, releases, collaborators, Actions runs), `delete_repo` (deleting
 * repositories; `repo` does NOT include it) and `workflow` (creating or editing files under .github/workflows).
 * `delete_repo` and `workflow` were added after launch: older connections lack them, so a call GitHub refuses
 * for a missing scope becomes a MissingScopeError ("Reconnect GitHub to allow this") instead of a generic error.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
 */
const API = "https://api.github.com";
const CONNECTOR = "github", NAME = "GitHub";

/** Owner / repo / user names: no slashes, and never just dots (".." would change the URL path). */
const name = z.string().regex(/^(?!\.+$)[A-Za-z0-9_.-]{1,100}$/);
const noDotSegments = (s: string) => !s.split("/").some((p) => p === "." || p === "..");
const refName = z.string().min(1).max(200).refine((s) => noDotSegments(s) && !/[\s~^:?*[\\\x00-\x1f]/.test(s) && !s.startsWith("/"), "Not a valid branch or tag name");
const filePath = z.string().min(1).max(500).refine((s) => noDotSegments(s) && !s.startsWith("/"), "Not a valid file path");
const repoArgs = { owner: name, repo: name };

/** Commits straight to these branch names usually ship to production, so they need approval. */
const PROTECTED = new Set(["main", "master", "production", "prod", "release"]);

/** Scopes that include others (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). */
const IMPLIES: Record<string, string[]> = {
  repo: ["public_repo", "repo:status", "repo_deployment", "repo:invite", "security_events"],
  "admin:org": ["write:org", "read:org"], "write:org": ["read:org"],
  "admin:repo_hook": ["write:repo_hook", "read:repo_hook"], "write:repo_hook": ["read:repo_hook"],
  user: ["read:user", "user:email", "user:follow"],
};
function hasScope(granted: string[], s: string): boolean {
  return granted.includes(s) || granted.some((g) => IMPLIES[g]?.includes(s));
}
const splitScopes = (h: string | null | undefined) => (h ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Which scope GitHub wanted and the token lacks, if that's why the call failed. `x-oauth-scopes` is only sent for
 * OAuth/classic tokens (GitHub App and fine-grained tokens send it empty); without it we can't tell, so only the
 * message is checked.
 */
export function missingGithubScope(status: number, headers: Headers, message: string, need?: string): string | null {
  if (/`?workflow`? scope/i.test(message)) return "workflow";
  if (![403, 404, 422].includes(status)) return null;
  const have = headers.get("x-oauth-scopes");
  // Absent or empty (GitHub App user tokens and fine-grained PATs send an empty header): permissions, not scopes.
  if (!have?.trim()) return null;
  const granted = splitScopes(have);
  const wanted = need ? [need] : splitScopes(headers.get("x-accepted-oauth-scopes"));
  if (!wanted.length || wanted.some((w) => hasScope(granted, w))) return null;
  return wanted[0];
}

type Init = { method?: string; body?: unknown; need?: string };

/** One GitHub REST call. Returns the JSON body and the token's granted scopes (null when GitHub doesn't say). */
async function ghRaw<T>(ctx: ToolContext, path: string, init: Init = {}): Promise<{ data: T; scopes: string[] | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r: Response;
  try {
    r = await ctx.fetch(`${API}${path}`, {
      method: init.method ?? "GET", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ConnectorError("api.github.com didn't respond in time", 504);
  } finally { clearTimeout(timer); }
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { message?: string; errors?: { message?: string; code?: string; field?: string }[] };
      const extra = (j.errors ?? []).map((e) => e.message ?? [e.field, e.code].filter(Boolean).join(" ")).filter(Boolean).join("; ");
      detail = [j.message, extra].filter(Boolean).join(": ").slice(0, 300);
    } catch { detail = ""; }
    const scope = missingGithubScope(r.status, r.headers, detail, init.need);
    if (scope) throw new MissingScopeError(CONNECTOR, NAME, scope);
    const code = r.status === 401 ? "auth" : r.status === 403 ? "auth" : r.status === 404 ? "not_found" : r.status === 429 ? "rate_limited" : r.status === 422 ? "invalid" : "provider";
    const hint = r.status === 404 ? " (not found, or your GitHub account can't see it)" : "";
    throw new ConnectorError(`api.github.com returned ${r.status}${detail ? `: ${detail}` : ""}${hint}`, r.status, code);
  }
  const scopesHeader = r.headers.get("x-oauth-scopes");
  let data: unknown = {};
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { data: data as T, scopes: scopesHeader?.trim() ? splitScopes(scopesHeader) : null };
}
const call = async <T = unknown>(ctx: ToolContext, path: string, init: Init = {}) => (await ghRaw<T>(ctx, path, init)).data;

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const R = (a: { owner: string; repo: string }) => `/repos/${a.owner}/${a.repo}`;
const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};
type Repo = Record<string, unknown> & { full_name?: string; private?: boolean; default_branch?: string; archived?: boolean; pushed_at?: string; stargazers_count?: number; forks_count?: number; html_url?: string };
const vis = (r: Repo) => (r.private ? "Private" : "Public");
const day = (iso?: string) => (iso && !isNaN(Date.parse(iso)) ? iso.slice(0, 10) : "unknown");
const defaultBranch = async (ctx: ToolContext, a: { owner: string; repo: string }) => String((await call<Repo>(ctx, R(a))).default_branch ?? "main");

/** Before a delete: a token without delete_repo would only fail after the user approved, so refuse up front. */
function requireScope(scopes: string[] | null, s: string) {
  if (scopes && !hasScope(scopes, s)) throw new MissingScopeError(CONNECTOR, NAME, s);
}

const repoList = z.array(z.object(repoArgs)).min(1).max(20);
const deleteInput = z.object({
  owner: name.optional(), repo: name.optional(),
  repos: repoList.optional().describe("Several repositories to delete at once (one approval card lists them all)"),
}).refine((a) => !!a.repos?.length || (!!a.owner && !!a.repo), "Give owner and repo, or repos");
const reposOf = (a: z.infer<typeof deleteInput>) => {
  const list = a.repos?.length ? a.repos : [{ owner: a.owner!, repo: a.repo! }];
  const seen = new Set<string>();
  return list.filter((r) => { const k = `${r.owner}/${r.repo}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

const releaseRef = z.object({ ...repoArgs, release_id: z.number().int().positive().optional(), tag: refName.optional() }).refine((a) => a.release_id || a.tag, "Give release_id or tag");
async function findRelease(ctx: ToolContext, a: { owner: string; repo: string; release_id?: number; tag?: string }) {
  return a.release_id
    ? call<Record<string, unknown>>(ctx, `${R(a)}/releases/${a.release_id}`)
    : call<Record<string, unknown>>(ctx, `${R(a)}/releases/tags/${enc(a.tag!)}`);
}

export const github = defineConnector({
  id: CONNECTOR,
  name: NAME,
  icon: "GH",
  description: "Manage your GitHub repositories end to end: files, branches, pull requests, issues, releases, collaborators, Actions, settings, and deleting repos (with your approval).",
  auth: "oauth",
  scopes: ["repo", "delete_repo", "workflow"],
  addedScopes: ["delete_repo", "workflow"],
  capabilities: [
    "List repositories, read files, branches, pull requests, issues, releases, collaborators and Actions runs",
    "Create repos, branches, files and pull requests; commit, edit and delete files",
    "Rename repos, update description/topics, archive or unarchive, change public/private",
    "Merge pull requests, close or reopen issues and PRs, create and delete releases",
    "Add or remove collaborators, trigger workflows, delete branches and delete repositories",
    "Anything destructive or public (delete, merge, visibility, collaborators, main-branch commits) waits for your approval",
  ],
  permissions: [
    "GitHub's “repo” permission: read and write access to code, issues, pull requests, releases and settings in your public and private repositories.",
    "“delete_repo”: lets TARGET delete a repository, only after you approve that exact repository on an approval card.",
    "“workflow”: lets TARGET create or edit GitHub Actions workflow files (.github/workflows).",
    "You can revoke access any time in GitHub → Settings → Applications.",
  ],
  requiredEnv: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    extraAuthorizeParams: { allow_signup: "false" },
    refreshable: true,
    async accountLabel(token, _j, f) {
      const u = await apiFetch<{ login?: string }>(`${API}/user`, { f, headers: { Authorization: `Bearer ${token}` } });
      return u.login ? `@${u.login}` : "";
    },
    async revoke(creds, env, f) {
      const id = env.GITHUB_OAUTH_CLIENT_ID, secret = env.GITHUB_OAUTH_CLIENT_SECRET;
      if (!id || !secret) return;
      await apiFetch(`${API}/applications/${id}/grant`, {
        method: "DELETE", f, body: { access_token: creds.access_token },
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, Accept: "application/vnd.github+json" },
      }).catch(() => undefined);
    },
  },
  docs: [
    "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
    "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps",
    "https://docs.github.com/en/rest/repos/repos",
    "https://docs.github.com/en/rest/git",
    "https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request",
    "https://docs.github.com/en/rest/releases/releases",
    "https://docs.github.com/en/rest/collaborators/collaborators",
    "https://docs.github.com/en/rest/actions/workflows",
    "https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization",
  ],
  todo: ["Reading files larger than 1 MB (contents API limit) is not supported.", "Fine-grained access via a GitHub App instead of an OAuth App."],
  getTools: () => [
    // ------------------------------------------------------------ repositories
    tool({
      name: "list_repos",
      description: "List repositories you can access, most recently updated first. Use page for more than 100.",
      input: z.object({
        limit: z.number().int().min(1).max(100).default(30), page: z.number().int().min(1).max(50).default(1),
        type: z.enum(["all", "owner", "member"]).default("all").describe("owner = only repos you own"),
      }),
      async execute(a, ctx) {
        const rs = await call<Repo[]>(ctx, `/user/repos${qs({ per_page: a.limit, page: a.page, sort: "updated", type: a.type })}`);
        return rs.map((r) => ({ full_name: r.full_name, private: r.private, archived: r.archived, fork: r.fork, default_branch: r.default_branch, description: r.description, updated_at: r.updated_at }));
      },
    }),
    tool({
      name: "get_repo",
      description: "Get one repository's details (visibility, default branch, archived, topics, stars, your permissions).",
      input: z.object(repoArgs),
      async execute(a, ctx) {
        const r = await call<Repo>(ctx, R(a));
        return { full_name: r.full_name, private: r.private, visibility: r.visibility, archived: r.archived, fork: r.fork, default_branch: r.default_branch, description: r.description, homepage: r.homepage, topics: r.topics, stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count, pushed_at: r.pushed_at, html_url: r.html_url, permissions: r.permissions };
      },
    }),
    tool({
      name: "create_repo",
      description: "Create a new repository under your account or an organization (private by default).",
      input: z.object({ name, private: z.boolean().default(true), description: z.string().max(300).optional(), org: name.optional().describe("Organization login; omit for your own account"), auto_init: z.boolean().default(true) }),
      async execute(a, ctx) {
        const r = await call<Repo>(ctx, a.org ? `/orgs/${a.org}/repos` : "/user/repos", { method: "POST", body: { name: a.name, private: a.private, description: a.description, auto_init: a.auto_init } });
        return { full_name: r.full_name, html_url: r.html_url, private: r.private, default_branch: r.default_branch };
      },
    }),
    tool({
      name: "delete_repo",
      description: "Permanently delete one repository (owner + repo) or several (repos). The user approves the exact repositories on an approval card first; call this whenever they ask to delete repos instead of telling them to do it manually.",
      input: deleteInput,
      requiresApproval: true,
      summarize: (a) => { const l = reposOf(a); return l.length === 1 ? `Delete the GitHub repository ${l[0].owner}/${l[0].repo}` : `Delete ${l.length} GitHub repositories`; },
      async prepare(a, ctx) {
        const list = reposOf(a);
        const found = await Promise.all(list.map((r) => ghRaw<Repo>(ctx, R(r))));
        requireScope(found[0].scopes, "delete_repo");
        const rows = found.map(({ data: r }) => `${r.full_name} · ${vis(r)}${r.archived ? " · archived" : ""} · last push ${day(r.pushed_at)} · ${r.stargazers_count ?? 0}★ ${r.forks_count ?? 0} forks`);
        const pub = found.filter((f) => !f.data.private).length;
        const details: Record<string, string> = list.length === 1
          ? { Repository: String(found[0].data.full_name), Visibility: vis(found[0].data), "Last push": day(found[0].data.pushed_at), "Stars / forks": `${found[0].data.stargazers_count ?? 0} / ${found[0].data.forks_count ?? 0}`, ...(found[0].data.archived ? { Archived: "yes" } : {}) }
          : { Repositories: rows.join("\n"), Count: `${list.length} (${list.length - pub} private, ${pub} public)` };
        return {
          summary: list.length === 1 ? `Delete ${found[0].data.private ? "private" : "public"} repository ${found[0].data.full_name}` : `Delete ${list.length} GitHub repositories`,
          details,
          warning: `This PERMANENTLY deletes ${list.length === 1 ? "this repository" : `these ${list.length} repositories`} with all code, history, issues, pull requests, releases, wiki and settings. TARGET can't undo it. (GitHub may let the owner restore a deleted repository for up to 90 days from Settings → Repositories → Deleted repositories, unless it was a fork.)`,
        };
      },
      async execute(a, ctx) {
        const deleted: string[] = [], failed: { repo: string; error: string }[] = [];
        for (const r of reposOf(a)) {
          try { await call(ctx, R(r), { method: "DELETE", need: "delete_repo" }); deleted.push(`${r.owner}/${r.repo}`); }
          catch (e) {
            if (e instanceof MissingScopeError) throw e;
            failed.push({ repo: `${r.owner}/${r.repo}`, error: e instanceof Error ? e.message : "failed" });
          }
        }
        if (!deleted.length) throw new ConnectorError(`Nothing was deleted. ${failed.map((f) => `${f.repo}: ${f.error}`).join("; ")}`.slice(0, 400), 502);
        return { deleted, ...(failed.length ? { failed } : {}) };
      },
    }),
    tool({
      name: "archive_repo",
      description: "Archive a repository (read-only for everyone; reversible) or unarchive it (archived: false). Archiving asks the user first.",
      input: z.object({ ...repoArgs, archived: z.boolean().default(true) }),
      requiresApproval: (a) => a.archived !== false,
      summarize: (a) => `${a.archived === false ? "Unarchive" : "Archive"} ${a.owner}/${a.repo}`,
      async prepare(a, ctx) {
        const r = await call<Repo>(ctx, R(a));
        if (!!r.archived === (a.archived !== false)) throw new ConnectorError(`${r.full_name} is already ${r.archived ? "archived" : "not archived"}.`, 400, "invalid");
        return { details: { Repository: String(r.full_name), Visibility: vis(r) }, warning: "Archived repositories become read-only: no pushes, issues or pull requests until you unarchive it." };
      },
      async execute(a, ctx) {
        const r = await call<Repo>(ctx, R(a), { method: "PATCH", body: { archived: a.archived !== false } });
        return { full_name: r.full_name, archived: r.archived };
      },
    }),
    tool({
      name: "rename_repo",
      description: "Rename a repository. GitHub redirects the old URL to the new one.",
      input: z.object({ ...repoArgs, new_name: name }),
      async execute(a, ctx) {
        const r = await call<Repo>(ctx, R(a), { method: "PATCH", body: { name: a.new_name } });
        return { full_name: r.full_name, html_url: r.html_url, note: "Old links and git remotes redirect to the new name." };
      },
    }),
    tool({
      name: "set_repo_visibility",
      description: "Make a repository private or public. Always asks the user first.",
      input: z.object({ ...repoArgs, private: z.boolean() }),
      requiresApproval: true,
      summarize: (a) => `Make ${a.owner}/${a.repo} ${a.private ? "private" : "public"}`,
      async prepare(a, ctx) {
        const r = await call<Repo>(ctx, R(a));
        if (!!r.private === a.private) throw new ConnectorError(`${r.full_name} is already ${vis(r).toLowerCase()}.`, 400, "invalid");
        return {
          details: { Repository: String(r.full_name), Change: `${vis(r)} → ${a.private ? "Private" : "Public"}` },
          warning: a.private
            ? "Making it private hides it from everyone except you and collaborators. Stars and watchers from people without access are removed, and existing public forks stay public in their own network."
            : "Making it public lets anyone on the internet see all code, commit history, issues and pull requests. Make sure no secrets or private data are committed anywhere in its history.",
        };
      },
      async execute(a, ctx) {
        const r = await call<Repo>(ctx, R(a), { method: "PATCH", body: { private: a.private } });
        return { full_name: r.full_name, private: r.private };
      },
    }),
    tool({
      name: "update_repo",
      description: "Update a repository's description, homepage and/or topics (topics replace the current list).",
      input: z.object({
        ...repoArgs, description: z.string().max(350).optional(), homepage: z.string().max(300).optional(),
        topics: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/)).max(20).optional().describe("Lowercase letters, numbers and hyphens"),
      }),
      async execute(a, ctx) {
        const out: Record<string, unknown> = {};
        if (a.description !== undefined || a.homepage !== undefined) {
          const r = await call<Repo>(ctx, R(a), { method: "PATCH", body: { ...(a.description !== undefined ? { description: a.description } : {}), ...(a.homepage !== undefined ? { homepage: a.homepage } : {}) } });
          Object.assign(out, { description: r.description, homepage: r.homepage });
        }
        if (a.topics) out.topics = (await call<{ names: string[] }>(ctx, `${R(a)}/topics`, { method: "PUT", body: { names: a.topics } })).names;
        if (!Object.keys(out).length) throw new ConnectorError("Nothing to update: give description, homepage or topics.", 400, "invalid");
        return { full_name: `${a.owner}/${a.repo}`, ...out };
      },
    }),
    // ------------------------------------------------------------ files
    tool({
      name: "read_file",
      description: "Read a text file (or list a directory) from a repository.",
      input: z.object({ ...repoArgs, path: filePath, ref: refName.optional() }),
      async execute(a, ctx) {
        const j = await call<Record<string, unknown> | Record<string, unknown>[]>(ctx, `${R(a)}/contents/${enc(a.path)}${a.ref ? `?ref=${encodeURIComponent(a.ref)}` : ""}`);
        if (Array.isArray(j)) return { directory: a.path, entries: j.map((e) => ({ name: e.name, type: e.type, path: e.path })) };
        if (j.encoding !== "base64" || typeof j.content !== "string") return { path: a.path, note: "File too large or not a regular file." };
        return { path: a.path, sha: j.sha, content: clip(Buffer.from(j.content, "base64").toString("utf8"), 20000) };
      },
    }),
    tool({
      name: "put_file",
      description: "Create or update one text file in a single commit (finds the existing file's sha itself). Writing to main/master/production, or to the default branch when no branch is given, asks the user first.",
      input: z.object({ ...repoArgs, path: filePath, content: z.string().max(500000), message: z.string().min(1).max(500), branch: refName.optional() }),
      requiresApproval: (a) => !a.branch || PROTECTED.has(a.branch.toLowerCase()),
      summarize: (a) => `Write ${a.path} in ${a.owner}/${a.repo}${a.branch ? ` on ${a.branch}` : " (default branch)"}`,
      async execute(a, ctx) {
        let sha: string | undefined;
        try { sha = String((await call<Record<string, unknown>>(ctx, `${R(a)}/contents/${enc(a.path)}${a.branch ? `?ref=${encodeURIComponent(a.branch)}` : ""}`)).sha ?? "") || undefined; }
        catch (e) { if (!(e instanceof ConnectorError && e.status === 404) || e instanceof MissingScopeError) throw e; }
        const r = await call<{ commit?: { sha?: string; html_url?: string } }>(ctx, `${R(a)}/contents/${enc(a.path)}`, {
          method: "PUT", body: { message: a.message, content: Buffer.from(a.content, "utf8").toString("base64"), ...(sha ? { sha } : {}), ...(a.branch ? { branch: a.branch } : {}) },
          ...(a.path.startsWith(".github/workflows/") ? { need: "workflow" } : {}),
        });
        return { path: a.path, created: !sha, commit: r.commit?.sha, html_url: r.commit?.html_url };
      },
    }),
    tool({
      name: "delete_file",
      description: "Delete one file in a commit. Always asks the user first.",
      input: z.object({ ...repoArgs, path: filePath, message: z.string().min(1).max(500), branch: refName.optional() }),
      requiresApproval: true,
      summarize: (a) => `Delete ${a.path} from ${a.owner}/${a.repo}${a.branch ? ` on ${a.branch}` : ""}`,
      async prepare(a, ctx) {
        const f = await call<Record<string, unknown> | unknown[]>(ctx, `${R(a)}/contents/${enc(a.path)}${a.branch ? `?ref=${encodeURIComponent(a.branch)}` : ""}`);
        if (Array.isArray(f) || f.type !== "file") throw new ConnectorError(`${a.path} is a directory, not a file. Delete its files one by one.`, 400, "invalid");
        return { details: { Repository: `${a.owner}/${a.repo}`, File: a.path, Branch: a.branch ?? "default branch", Size: `${f.size ?? "?"} bytes`, "Commit message": a.message } };
      },
      async execute(a, ctx) {
        const f = await call<Record<string, unknown>>(ctx, `${R(a)}/contents/${enc(a.path)}${a.branch ? `?ref=${encodeURIComponent(a.branch)}` : ""}`);
        const r = await call<{ commit?: { sha?: string } }>(ctx, `${R(a)}/contents/${enc(a.path)}`, {
          method: "DELETE", body: { message: a.message, sha: f.sha, ...(a.branch ? { branch: a.branch } : {}) },
          ...(a.path.startsWith(".github/workflows/") ? { need: "workflow" } : {}),
        });
        return { deleted: a.path, commit: r.commit?.sha };
      },
    }),
    tool({
      name: "commit_files",
      description: "Commit one or more text files to an existing branch in a single commit. Commits to main/master/production need approval.",
      input: z.object({
        ...repoArgs, branch: refName, message: z.string().min(1).max(500),
        files: z.array(z.object({ path: filePath, content: z.string().max(500000) })).min(1).max(30),
      }),
      requiresApproval: (a) => PROTECTED.has(a.branch.toLowerCase()),
      summarize: (a) => `Commit ${a.files.length} file(s) to ${a.owner}/${a.repo} on ${a.branch}`,
      async execute(a, ctx) {
        const G = `${R(a)}/git`;
        const need = a.files.some((f) => f.path.startsWith(".github/workflows/")) ? { need: "workflow" } : {};
        const head = await call<{ object: { sha: string } }>(ctx, `${G}/ref/heads/${enc(a.branch)}`);
        const commit = await call<{ tree: { sha: string } }>(ctx, `${G}/commits/${head.object.sha}`);
        const tree = await call<{ sha: string }>(ctx, `${G}/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree: a.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })) } });
        const next = await call<{ sha: string }>(ctx, `${G}/commits`, { method: "POST", body: { message: a.message, tree: tree.sha, parents: [head.object.sha] } });
        await call(ctx, `${G}/refs/heads/${enc(a.branch)}`, { method: "PATCH", body: { sha: next.sha }, ...need });
        return { commit: next.sha, branch: a.branch, files: a.files.map((f) => f.path) };
      },
    }),
    // ------------------------------------------------------------ branches
    tool({
      name: "list_branches",
      description: "List a repository's branches.",
      input: z.object({ ...repoArgs, limit: z.number().int().min(1).max(100).default(50) }),
      async execute(a, ctx) {
        const bs = await call<{ name: string; protected?: boolean; commit?: { sha?: string } }[]>(ctx, `${R(a)}/branches${qs({ per_page: a.limit })}`);
        return bs.map((b) => ({ name: b.name, protected: b.protected, sha: b.commit?.sha }));
      },
    }),
    tool({
      name: "create_branch",
      description: "Create a branch from another branch (defaults to the repo's default branch).",
      input: z.object({ ...repoArgs, branch: refName, from: refName.optional() }),
      async execute(a, ctx) {
        const base = a.from ?? await defaultBranch(ctx, a);
        const ref = await call<{ object: { sha: string } }>(ctx, `${R(a)}/git/ref/heads/${enc(base)}`);
        await call(ctx, `${R(a)}/git/refs`, { method: "POST", body: { ref: `refs/heads/${a.branch}`, sha: ref.object.sha } });
        return { branch: a.branch, from: base, sha: ref.object.sha };
      },
    }),
    tool({
      name: "delete_branch",
      description: "Delete a branch (never the default branch). Always asks the user first.",
      input: z.object({ ...repoArgs, branch: refName }),
      requiresApproval: true,
      summarize: (a) => `Delete branch ${a.branch} in ${a.owner}/${a.repo}`,
      async prepare(a, ctx) {
        const def = await defaultBranch(ctx, a);
        if (def === a.branch) throw new ConnectorError(`${a.branch} is the default branch of ${a.owner}/${a.repo}; GitHub won't delete it. Change the default branch first.`, 400, "invalid");
        const b = await call<{ name: string; protected?: boolean; commit?: { sha?: string } }>(ctx, `${R(a)}/branches/${enc(a.branch)}`);
        return { details: { Repository: `${a.owner}/${a.repo}`, Branch: b.name, "Last commit": String(b.commit?.sha ?? "").slice(0, 7), ...(b.protected ? { Protected: "yes" } : {}) }, warning: "Commits that exist only on this branch will no longer be reachable unless they were merged elsewhere." };
      },
      async execute(a, ctx) {
        await call(ctx, `${R(a)}/git/refs/heads/${enc(a.branch)}`, { method: "DELETE" });
        return { deleted_branch: a.branch, repo: `${a.owner}/${a.repo}` };
      },
    }),
    // ------------------------------------------------------------ pull requests and issues
    tool({
      name: "list_pull_requests",
      description: "List pull requests in a repository.",
      input: z.object({ ...repoArgs, state: z.enum(["open", "closed", "all"]).default("open"), limit: z.number().int().min(1).max(100).default(30) }),
      async execute(a, ctx) {
        const ps = await call<Record<string, unknown>[]>(ctx, `${R(a)}/pulls${qs({ state: a.state, per_page: a.limit })}`);
        return ps.map((p) => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, head: (p.head as { ref?: string })?.ref, base: (p.base as { ref?: string })?.ref, merged_at: p.merged_at, user: (p.user as { login?: string })?.login, html_url: p.html_url }));
      },
    }),
    tool({
      name: "open_pull_request",
      description: "Open a pull request (draft by default).",
      input: z.object({ ...repoArgs, title: z.string().min(1).max(250), head: refName, base: refName, body: z.string().max(20000).optional(), draft: z.boolean().default(true) }),
      async execute(a, ctx) {
        const pr = await call<Record<string, unknown>>(ctx, `${R(a)}/pulls`, { method: "POST", body: { title: a.title, head: a.head, base: a.base, body: a.body, draft: a.draft } });
        return { number: pr.number, html_url: pr.html_url, draft: pr.draft };
      },
    }),
    tool({
      name: "merge_pull_request",
      description: "Merge a pull request (merge, squash or rebase). Always asks the user first.",
      input: z.object({ ...repoArgs, number: z.number().int().positive(), method: z.enum(["merge", "squash", "rebase"]).default("merge"), commit_title: z.string().max(250).optional(), commit_message: z.string().max(5000).optional() }),
      requiresApproval: true,
      summarize: (a) => `Merge pull request #${a.number} in ${a.owner}/${a.repo} (${a.method})`,
      async prepare(a, ctx) {
        const p = await call<Record<string, unknown>>(ctx, `${R(a)}/pulls/${a.number}`);
        if (p.state !== "open") throw new ConnectorError(`Pull request #${a.number} is ${p.merged ? "already merged" : "closed"}.`, 400, "invalid");
        if (p.draft) throw new ConnectorError(`Pull request #${a.number} is still a draft. Mark it ready for review on GitHub first.`, 400, "invalid");
        return {
          summary: `Merge #${a.number} “${String(p.title).slice(0, 120)}” into ${(p.base as { ref?: string })?.ref} (${a.method})`,
          details: { Repository: `${a.owner}/${a.repo}`, "Pull request": `#${a.number} ${String(p.title).slice(0, 200)}`, Branches: `${(p.head as { ref?: string })?.ref} → ${(p.base as { ref?: string })?.ref}`, Method: a.method, Mergeable: p.mergeable === false ? "no (conflicts or failing requirements)" : p.mergeable ? "yes" : "being checked by GitHub", Changes: `${p.changed_files ?? "?"} files, +${p.additions ?? 0} −${p.deletions ?? 0}` },
        };
      },
      async execute(a, ctx) {
        const r = await call<{ merged?: boolean; sha?: string; message?: string }>(ctx, `${R(a)}/pulls/${a.number}/merge`, { method: "PUT", body: { merge_method: a.method, ...(a.commit_title ? { commit_title: a.commit_title } : {}), ...(a.commit_message ? { commit_message: a.commit_message } : {}) } });
        return { merged: r.merged, sha: r.sha, message: r.message };
      },
    }),
    tool({
      name: "list_issues",
      description: "List issues in a repository (pull requests left out).",
      input: z.object({ ...repoArgs, state: z.enum(["open", "closed", "all"]).default("open"), limit: z.number().int().min(1).max(100).default(30) }),
      async execute(a, ctx) {
        const is = await call<Record<string, unknown>[]>(ctx, `${R(a)}/issues${qs({ state: a.state, per_page: a.limit })}`);
        return is.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, labels: (i.labels as { name?: string }[] | undefined)?.map((l) => l.name), user: (i.user as { login?: string })?.login, comments: i.comments, html_url: i.html_url }));
      },
    }),
    tool({
      name: "set_issue_state",
      description: "Close or reopen an issue or a pull request by number.",
      input: z.object({ ...repoArgs, number: z.number().int().positive(), state: z.enum(["open", "closed"]), reason: z.enum(["completed", "not_planned"]).optional().describe("Issues only, when closing") }),
      async execute(a, ctx) {
        const i = await call<Record<string, unknown>>(ctx, `${R(a)}/issues/${a.number}`, { method: "PATCH", body: { state: a.state, ...(a.reason && a.state === "closed" ? { state_reason: a.reason } : {}) } });
        return { number: i.number, state: i.state, is_pull_request: !!i.pull_request, html_url: i.html_url };
      },
    }),
    // ------------------------------------------------------------ releases
    tool({
      name: "list_releases",
      description: "List a repository's releases.",
      input: z.object({ ...repoArgs, limit: z.number().int().min(1).max(100).default(20) }),
      async execute(a, ctx) {
        const rs = await call<Record<string, unknown>[]>(ctx, `${R(a)}/releases${qs({ per_page: a.limit })}`);
        return rs.map((r) => ({ id: r.id, tag: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at, html_url: r.html_url }));
      },
    }),
    tool({
      name: "create_release",
      description: "Create a release (and its tag if missing). Publishing a non-draft release notifies watchers, so that asks the user first; drafts don't.",
      input: z.object({ ...repoArgs, tag: refName, name: z.string().max(250).optional(), body: z.string().max(20000).optional(), target: refName.optional().describe("Branch or commit for a new tag (default branch if omitted)"), draft: z.boolean().default(false), prerelease: z.boolean().default(false), generate_notes: z.boolean().default(false) }),
      requiresApproval: (a) => !a.draft,
      summarize: (a) => `Publish release ${a.tag}${a.name ? ` “${a.name}”` : ""} in ${a.owner}/${a.repo}`,
      async execute(a, ctx) {
        const r = await call<Record<string, unknown>>(ctx, `${R(a)}/releases`, { method: "POST", body: { tag_name: a.tag, name: a.name, body: a.body, target_commitish: a.target, draft: a.draft, prerelease: a.prerelease, generate_release_notes: a.generate_notes } });
        return { id: r.id, tag: r.tag_name, draft: r.draft, html_url: r.html_url };
      },
    }),
    tool({
      name: "delete_release",
      description: "Delete a release by id or tag (optionally its git tag too). Always asks the user first.",
      input: z.object({ ...repoArgs, release_id: z.number().int().positive().optional(), tag: refName.optional(), delete_tag: z.boolean().default(false) }).refine((a) => a.release_id || a.tag, "Give release_id or tag"),
      requiresApproval: true,
      summarize: (a) => `Delete release ${a.tag ?? `#${a.release_id}`} in ${a.owner}/${a.repo}${a.delete_tag ? " and its tag" : ""}`,
      async prepare(a, ctx) {
        const r = await findRelease(ctx, releaseRef.parse(a));
        return { details: { Repository: `${a.owner}/${a.repo}`, Release: `${r.name || r.tag_name} (${r.tag_name})`, Published: day(r.published_at as string | undefined), "Git tag": a.delete_tag ? "deleted too" : "kept" }, warning: "The release page, its notes and uploaded assets are deleted." };
      },
      async execute(a, ctx) {
        const r = await findRelease(ctx, releaseRef.parse(a));
        await call(ctx, `${R(a)}/releases/${r.id}`, { method: "DELETE" });
        if (a.delete_tag) await call(ctx, `${R(a)}/git/refs/tags/${enc(String(r.tag_name))}`, { method: "DELETE" });
        return { deleted_release: r.tag_name, tag_deleted: a.delete_tag };
      },
    }),
    // ------------------------------------------------------------ collaborators
    tool({
      name: "list_collaborators",
      description: "List a repository's collaborators and their permission.",
      input: z.object({ ...repoArgs, limit: z.number().int().min(1).max(100).default(50) }),
      async execute(a, ctx) {
        const cs = await call<{ login: string; role_name?: string }[]>(ctx, `${R(a)}/collaborators${qs({ per_page: a.limit })}`);
        return cs.map((c) => ({ login: c.login, role: c.role_name }));
      },
    }),
    tool({
      name: "add_collaborator",
      description: "Invite a GitHub user to a repository (or change their permission). Always asks the user first.",
      input: z.object({ ...repoArgs, username: name, permission: z.enum(["pull", "triage", "push", "maintain", "admin"]).default("push") }),
      requiresApproval: true,
      summarize: (a) => `Give @${a.username} ${a.permission} access to ${a.owner}/${a.repo}`,
      async prepare(a, ctx) {
        const r = await call<Repo>(ctx, R(a));
        return { details: { Repository: `${r.full_name} (${vis(r)})`, User: `@${a.username}`, Permission: a.permission }, ...(a.permission === "admin" ? { warning: "Admin access lets them change settings, add people and delete the repository." } : {}) };
      },
      async execute(a, ctx) {
        const r = await call<Record<string, unknown>>(ctx, `${R(a)}/collaborators/${a.username}`, { method: "PUT", body: { permission: a.permission } });
        return { invited: !!r.id, username: a.username, permission: a.permission, note: r.id ? "Invitation sent; they must accept it." : "Permission updated." };
      },
    }),
    tool({
      name: "remove_collaborator",
      description: "Remove a collaborator from a repository. Always asks the user first.",
      input: z.object({ ...repoArgs, username: name }),
      requiresApproval: true,
      summarize: (a) => `Remove @${a.username} from ${a.owner}/${a.repo}`,
      async execute(a, ctx) {
        await call(ctx, `${R(a)}/collaborators/${a.username}`, { method: "DELETE" });
        return { removed: a.username, repo: `${a.owner}/${a.repo}` };
      },
    }),
    // ------------------------------------------------------------ Actions
    tool({
      name: "list_workflows",
      description: "List a repository's GitHub Actions workflows.",
      input: z.object(repoArgs),
      async execute(a, ctx) {
        const j = await call<{ workflows?: Record<string, unknown>[] }>(ctx, `${R(a)}/actions/workflows${qs({ per_page: 100 })}`);
        return (j.workflows ?? []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
      },
    }),
    tool({
      name: "list_workflow_runs",
      description: "List recent GitHub Actions runs, optionally for one workflow (id or file name like ci.yml) or branch.",
      input: z.object({ ...repoArgs, workflow: z.union([z.number().int().positive(), z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)]).optional(), branch: refName.optional(), status: z.enum(["queued", "in_progress", "completed", "success", "failure", "cancelled"]).optional(), limit: z.number().int().min(1).max(50).default(10) }),
      async execute(a, ctx) {
        const base = a.workflow !== undefined ? `${R(a)}/actions/workflows/${encodeURIComponent(String(a.workflow))}/runs` : `${R(a)}/actions/runs`;
        const j = await call<{ workflow_runs?: Record<string, unknown>[] }>(ctx, `${base}${qs({ per_page: a.limit, branch: a.branch, status: a.status })}`);
        return (j.workflow_runs ?? []).map((r) => ({ id: r.id, name: r.name, branch: r.head_branch, event: r.event, status: r.status, conclusion: r.conclusion, sha: String(r.head_sha ?? "").slice(0, 7), created_at: r.created_at, html_url: r.html_url }));
      },
    }),
    tool({
      name: "trigger_workflow",
      description: "Run a workflow that has a workflow_dispatch trigger (id or file name like deploy.yml). Asks the user first, because workflows can deploy or publish.",
      input: z.object({ ...repoArgs, workflow: z.union([z.number().int().positive(), z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)]), ref: refName.optional(), inputs: z.record(z.string(), z.string().max(1000)).optional() }),
      requiresApproval: true,
      summarize: (a) => `Run workflow ${a.workflow} in ${a.owner}/${a.repo}${a.ref ? ` on ${a.ref}` : ""}`,
      async execute(a, ctx) {
        const ref = a.ref ?? await defaultBranch(ctx, a);
        await call(ctx, `${R(a)}/actions/workflows/${encodeURIComponent(String(a.workflow))}/dispatches`, { method: "POST", body: { ref, ...(a.inputs ? { inputs: a.inputs } : {}) } });
        return { triggered: true, workflow: a.workflow, ref, note: "Started. Use list_workflow_runs to follow it." };
      },
    }),
  ],
});

