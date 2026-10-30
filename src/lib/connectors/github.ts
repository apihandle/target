import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/** GitHub, via the REST API with an OAuth App user token. */
const API = "https://api.github.com";
const name = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
/** Commits straight to these branch names usually ship to production, so they need approval. */
const PROTECTED = new Set(["main", "master", "production", "prod", "release"]);

export const github = defineConnector({
  id: "github",
  name: "GitHub",
  icon: "GH",
  description: "Browse your repositories, read files, create repos and branches, commit files and open pull requests.",
  auth: "oauth",
  scopes: ["repo"],
  capabilities: [
    "List your repositories and read files",
    "Create repositories and branches",
    "Commit files (commits to main/master ask you first)",
    "Open pull requests",
  ],
  permissions: [
    "GitHub's “repo” permission: read and write access to code, issues and pull requests in your public and private repositories.",
    "GitHub has no narrower OAuth scope that allows writing to private repos. TARGET never deletes repositories.",
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
    "https://docs.github.com/en/rest/git",
    "https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization",
  ],
  todo: ["Reading files larger than 1 MB (contents API limit) is not supported.", "Fine-grained access via a GitHub App instead of an OAuth App."],
  getTools: () => [
    tool({
      name: "list_repos",
      description: "List repositories you can access, most recently updated first.",
      input: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
      async execute(a, ctx) {
        const rs = await call<Record<string, unknown>[]>(ctx, `/user/repos?per_page=${a.limit}&sort=updated`);
        return rs.map((r) => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch, description: r.description, updated_at: r.updated_at }));
      },
    }),
    tool({
      name: "read_file",
      description: "Read a text file from a repository.",
      input: z.object({ owner: name, repo: name, path: z.string().min(1).max(500), ref: z.string().max(200).optional() }),
      async execute(a, ctx) {
        const j = await call<Record<string, unknown> | Record<string, unknown>[]>(ctx, `/repos/${a.owner}/${a.repo}/contents/${enc(a.path)}${a.ref ? `?ref=${encodeURIComponent(a.ref)}` : ""}`);
        if (Array.isArray(j)) return { directory: a.path, entries: j.map((e) => ({ name: e.name, type: e.type, path: e.path })) };
        if (j.encoding !== "base64" || typeof j.content !== "string") return { path: a.path, note: "File too large or not a regular file." };
        return { path: a.path, sha: j.sha, content: clip(Buffer.from(j.content, "base64").toString("utf8"), 20000) };
      },
    }),
    tool({
      name: "create_repo",
      description: "Create a new repository under your account (private by default).",
      input: z.object({ name, private: z.boolean().default(true), description: z.string().max(300).optional() }),
      async execute(a, ctx) {
        const r = await call<Record<string, unknown>>(ctx, "/user/repos", { method: "POST", body: { name: a.name, private: a.private, description: a.description, auto_init: true } });
        return { full_name: r.full_name, html_url: r.html_url, default_branch: r.default_branch };
      },
    }),
    tool({
      name: "create_branch",
      description: "Create a branch from another branch (defaults to the repo's default branch).",
      input: z.object({ owner: name, repo: name, branch: z.string().min(1).max(200), from: z.string().max(200).optional() }),
      async execute(a, ctx) {
        const base = a.from ?? String((await call<Record<string, unknown>>(ctx, `/repos/${a.owner}/${a.repo}`)).default_branch);
        const ref = await call<{ object: { sha: string } }>(ctx, `/repos/${a.owner}/${a.repo}/git/ref/heads/${enc(base)}`);
        await call(ctx, `/repos/${a.owner}/${a.repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${a.branch}`, sha: ref.object.sha } });
        return { branch: a.branch, from: base, sha: ref.object.sha };
      },
    }),
    tool({
      name: "commit_files",
      description: "Commit one or more text files to an existing branch in a single commit. Commits to main/master/production need approval.",
      input: z.object({
        owner: name, repo: name, branch: z.string().min(1).max(200), message: z.string().min(1).max(500),
        files: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().max(500000) })).min(1).max(30),
      }),
      requiresApproval: (a) => PROTECTED.has(a.branch.toLowerCase()),
      summarize: (a) => `Commit ${a.files.length} file(s) to ${a.owner}/${a.repo} on ${a.branch}`,
      async execute(a, ctx) {
        const R = `/repos/${a.owner}/${a.repo}/git`;
        const head = await call<{ object: { sha: string } }>(ctx, `${R}/ref/heads/${enc(a.branch)}`);
        const commit = await call<{ tree: { sha: string } }>(ctx, `${R}/commits/${head.object.sha}`);
        const tree = await call<{ sha: string }>(ctx, `${R}/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree: a.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })) } });
        const next = await call<{ sha: string; html_url?: string }>(ctx, `${R}/commits`, { method: "POST", body: { message: a.message, tree: tree.sha, parents: [head.object.sha] } });
        await call(ctx, `${R}/refs/heads/${enc(a.branch)}`, { method: "PATCH", body: { sha: next.sha } });
        return { commit: next.sha, branch: a.branch, files: a.files.map((f) => f.path) };
      },
    }),
    tool({
      name: "open_pull_request",
      description: "Open a pull request (draft by default).",
      input: z.object({ owner: name, repo: name, title: z.string().min(1).max(250), head: z.string().min(1).max(200), base: z.string().min(1).max(200), body: z.string().max(20000).optional(), draft: z.boolean().default(true) }),
      async execute(a, ctx) {
        const pr = await call<Record<string, unknown>>(ctx, `/repos/${a.owner}/${a.repo}/pulls`, { method: "POST", body: { title: a.title, head: a.head, base: a.base, body: a.body, draft: a.draft } });
        return { number: pr.number, html_url: pr.html_url, draft: pr.draft };
      },
    }),
  ],
});
