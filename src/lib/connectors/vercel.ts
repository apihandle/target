import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError, MissingScopeError } from "@/lib/connectors/http";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";

/**
 * Vercel, via the official REST API (https://api.vercel.com).
 *
 * Why REST and not the hosted MCP server (https://mcp.vercel.com): Vercel's MCP server only accepts
 * AI clients that Vercel has reviewed and allow-listed (https://vercel.com/docs/agent-resources/vercel-mcp),
 * so a self-hosted app like TARGET can't complete its OAuth flow.
 *
 * Auth: TARGET's Vercel Integration (external installation flow). Connect sends the user to
 * https://vercel.com/integrations/<VERCEL_INTEGRATION_SLUG>/new?state=…, Vercel redirects back with
 * code + configurationId (+ teamId when installed on a team), and the code is exchanged at
 * POST /v2/oauth/access_token for a long-lived token. When team_id is set every call adds ?teamId=.
 * https://vercel.com/docs/integrations/create-integration/vercel-api-integrations
 *
 * Permissions are set on the integration (Vercel → Integrations Console → Permissions). When the owner adds one,
 * Vercel asks each installation to review it; until then a call needing it gets 403, which becomes
 * "Reconnect Vercel to allow this". Environment variable values are never decrypted or returned.
 */
const API = "https://api.vercel.com";
const CONNECTOR = "vercel";
const NAME = "Vercel";
const team = z.string().max(100).optional().describe("Team id or slug, when the project belongs to a team");
const project = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "Project name or id").describe("Project name or id");
const deploymentId = z.string().regex(/^(dpl_)?[A-Za-z0-9]{1,60}$/, "Deployment id (dpl_…)");
const domainName = z.string().regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i, "A domain like www.example.com");
const ENV_TARGETS = ["production", "preview", "development"] as const;

const qs = (o: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};
const teamQ = (t?: string) => (t ? (t.startsWith("team_") ? { teamId: t } : { slug: t }) : {});
/** The team the integration was installed on, from the connection's saved metadata. */
const savedTeam = (ctx: ToolContext) => (typeof ctx.meta?.teamId === "string" && ctx.meta.teamId ? ctx.meta.teamId : undefined);
const scope = (ctx: ToolContext, t?: string) => teamQ(t ?? savedTeam(ctx));
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const P = (p: string) => encodeURIComponent(p);

type Init = Parameters<typeof apiFetch>[1] & { need?: string };
/** REST call. A 403 that names a missing permission asks the user to reconnect (review the integration's permissions). */
async function call<T = unknown>(ctx: ToolContext, path: string, init: Init = {}): Promise<T> {
  const { need, ...rest } = init;
  try {
    return await apiFetch<T>(`${API}${path}`, { ...rest, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}` } });
  } catch (e) {
    if (e instanceof ConnectorError && e.status === 403 && need && /scope|permission|not authorized|forbidden|insufficient/i.test(e.message)) throw new MissingScopeError(CONNECTOR, NAME, need);
    throw e;
  }
}

type Project = Record<string, unknown> & { id?: string; name?: string; framework?: string | null; buildCommand?: string | null; installCommand?: string | null; devCommand?: string | null; outputDirectory?: string | null; rootDirectory?: string | null; nodeVersion?: string; link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null; targets?: Record<string, { id?: string; url?: string; readyState?: string; createdAt?: number } | null> };
type Deployment = Record<string, unknown> & { uid?: string; id?: string; name?: string; url?: string; state?: string; readyState?: string; target?: string | null; created?: number; createdAt?: number; projectId?: string; meta?: Record<string, string> };
type EnvVar = { id?: string; key?: string; type?: string; target?: string[] | string; gitBranch?: string; updatedAt?: number; comment?: string };

const when = (ms?: number) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown");
const repoOf = (p: Project) => (p.link?.org && p.link?.repo ? `${p.link.type ?? "git"}: ${p.link.org}/${p.link.repo}` : "none");
const getProject = (ctx: ToolContext, p: string, t?: string) => call<Project>(ctx, `/v9/projects/${P(p)}${qs(scope(ctx, t))}`, { need: "project:read" });
const getDeployment = (ctx: ToolContext, id: string, t?: string) => call<Deployment>(ctx, `/v13/deployments/${P(id)}${qs(scope(ctx, t))}`, { need: "deployment:read" });
const depView = (d: Deployment) => ({
  id: d.uid ?? d.id, url: d.url ? `https://${d.url}` : undefined, state: d.state ?? d.readyState, target: d.target ?? "preview", created: when(d.created ?? d.createdAt),
  commit: d.meta?.githubCommitSha ? `${d.meta.githubCommitSha.slice(0, 7)} ${String(d.meta.githubCommitMessage ?? "").split("\n")[0].slice(0, 100)}` : undefined, branch: d.meta?.githubCommitRef,
});
const depRows = (d: Deployment): Record<string, string> => {
  const v = depView(d);
  return { Deployment: String(v.id), URL: v.url ?? "unknown", Target: String(v.target), State: String(v.state ?? "unknown"), Created: v.created, ...(v.commit ? { Commit: v.commit } : {}), ...(v.branch ? { Branch: v.branch } : {}) };
};
/** Never show an env var's value: Vercel returns ciphertext for encrypted ones and plaintext for "plain". */
const envView = (e: EnvVar) => ({ id: e.id, key: e.key, value: "•••••• (hidden)", type: e.type, target: e.target, gitBranch: e.gitBranch, updatedAt: when(e.updatedAt), comment: e.comment });
const targetsOf = (e: EnvVar) => (Array.isArray(e.target) ? e.target : e.target ? [e.target] : []);
const settingsView = (p: Project) => ({
  id: p.id, name: p.name, framework: p.framework ?? null, buildCommand: p.buildCommand ?? null, installCommand: p.installCommand ?? null, devCommand: p.devCommand ?? null,
  outputDirectory: p.outputDirectory ?? null, rootDirectory: p.rootDirectory ?? null, nodeVersion: p.nodeVersion, gitRepository: repoOf(p), productionBranch: p.link?.productionBranch,
  production: p.targets?.production ? { id: p.targets.production.id, url: p.targets.production.url ? `https://${p.targets.production.url}` : undefined, readyState: p.targets.production.readyState } : null,
});
const SETTINGS = ["framework", "buildCommand", "installCommand", "devCommand", "outputDirectory", "rootDirectory", "nodeVersion"] as const;
const cmd = z.string().max(256).nullable().optional();
const settingsInput = {
  framework: z.string().regex(/^[a-z0-9-]{1,40}$/).nullable().optional().describe("Framework preset, e.g. nextjs, vite, astro; null for Other"),
  buildCommand: cmd, installCommand: cmd, devCommand: cmd,
  outputDirectory: z.string().max(256).nullable().optional(), rootDirectory: z.string().max(256).nullable().optional(),
  nodeVersion: z.enum(["24.x", "22.x", "20.x"]).optional(),
};
const pickSettings = (a: Partial<Record<(typeof SETTINGS)[number], unknown>>) => Object.fromEntries(SETTINGS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "(default)" : String(v));

export const vercel = defineConnector({
  id: "vercel",
  name: "Vercel",
  icon: "V",
  description: "Manage your Vercel projects: deploy, promote and roll back, environment variables, domains, settings and logs.",
  auth: "oauth",
  scopes: [],
  capabilities: [
    "List teams, projects and deployments; read build logs",
    "Create projects, link a GitHub repository, read and change build settings (changing settings or the repo asks you first)",
    "Create preview deployments, redeploy, cancel a build; production deploys, promote and rollback ask you first",
    "List, add and update environment variables (values are never shown); deleting asks you first",
    "List domains, check DNS, add domains (asks you first) and remove domains (asks you first)",
    "Delete a project (asks you first)",
  ],
  permissions: [
    "You install TARGET's Vercel integration on your personal account or one team and choose which projects it can reach.",
    "Access is encrypted on TARGET's server. Remove the integration in Vercel → Settings → Integrations to cut access completely.",
  ],
  requiredEnv: ["VERCEL_OAUTH_CLIENT_ID", "VERCEL_OAUTH_CLIENT_SECRET", "VERCEL_INTEGRATION_SLUG"],
  oauth: {
    authorizeUrl: "https://vercel.com/integrations",
    tokenUrl: `${API}/v2/oauth/access_token`,
    clientIdEnv: "VERCEL_OAUTH_CLIENT_ID",
    clientSecretEnv: "VERCEL_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    refreshable: false,
    buildAuthorizeUrl(env, p) {
      const slug = encodeURIComponent(env.VERCEL_INTEGRATION_SLUG ?? "");
      return `https://vercel.com/integrations/${slug}/new?${new URLSearchParams({ state: p.state })}`;
    },
    parseToken(j) {
      const teamId = str(j.team_id), installationId = str(j.installation_id);
      return { meta: { ...(teamId ? { teamId } : {}), ...(installationId ? { installationId } : {}) } };
    },
    callbackMeta(q) {
      const configurationId = q.get("configurationId"), teamId = q.get("teamId");
      return {
        ...(configurationId && /^icfg_[A-Za-z0-9]{1,60}$/.test(configurationId) ? { configurationId } : {}),
        ...(teamId && /^team_[A-Za-z0-9]{1,60}$/.test(teamId) ? { teamId } : {}),
      };
    },
    async accountLabel(token, j, f) {
      const teamId = str(j.team_id);
      const h = { Authorization: `Bearer ${token}` };
      if (teamId) {
        const t = await apiFetch<{ slug?: string; name?: string }>(`${API}/v2/teams/${encodeURIComponent(teamId)}`, { f, headers: h }).catch(() => null);
        if (t?.name || t?.slug) return `${t.name ?? t.slug} (team)`;
      }
      const u = await apiFetch<{ user?: { username?: string } }>(`${API}/v2/user`, { f, headers: h }).catch(() => null);
      return u?.user?.username ? `@${u.user.username}` : "";
    },
    async revoke(creds, _env, f) {
      // Disconnecting uninstalls the integration configuration, which invalidates its token.
      const id = str(creds.meta?.configurationId);
      if (!id) return;
      const teamId = str(creds.meta?.teamId);
      await apiFetch(`${API}/v1/integrations/configuration/${encodeURIComponent(id)}${qs(teamId ? { teamId } : {})}`, {
        method: "DELETE", f, headers: { Authorization: `Bearer ${creds.access_token}` },
      }).catch(() => undefined);
    },
  },
  docs: [
    "https://vercel.com/docs/rest-api",
    "https://openapi.vercel.sh/",
    "https://vercel.com/docs/integrations/create-integration/vercel-api-integrations",
    "https://vercel.com/docs/integrations/create-integration/submit-integration#external-installation-flow",
    "https://vercel.com/docs/agent-resources/vercel-mcp",
  ],
  getTools: () => [
    // ── Teams and projects ──────────────────────────────────────────────────────────────────────
    tool({
      name: "list_teams",
      description: "List the Vercel teams this connection can reach (id, slug, name).",
      input: z.object({}),
      async execute(_a, ctx) {
        const j = await call<{ teams?: Record<string, unknown>[] }>(ctx, "/v2/teams?limit=50", { need: "team:read" });
        return (j.teams ?? []).map((t) => ({ id: t.id, slug: t.slug, name: t.name }));
      },
    }),
    tool({
      name: "list_projects",
      description: "List Vercel projects (id, name, framework, last update).",
      input: z.object({ team, search: z.string().max(100).optional() }),
      async execute(a, ctx) {
        const j = await call<{ projects?: Record<string, unknown>[] }>(ctx, `/v10/projects${qs({ limit: 50, search: a.search, ...scope(ctx, a.team) })}`, { need: "project:read" });
        return (j.projects ?? []).map((p) => ({ id: p.id, name: p.name, framework: p.framework, updatedAt: when(p.updatedAt as number) }));
      },
    }),
    tool({
      name: "get_project",
      description: "Get a project's settings: framework, build/install/dev commands, output and root directory, Node version, linked Git repository and current production deployment.",
      input: z.object({ project, team }),
      async execute(a, ctx) {
        return settingsView(await getProject(ctx, a.project, a.team));
      },
    }),
    tool({
      name: "create_project",
      description: "Create a new Vercel project, optionally linked to a GitHub repository (owner/repo) and with build settings.",
      input: z.object({
        name: z.string().regex(/^[a-z0-9._-]{1,100}$/, "Lowercase letters, digits, . _ -"), team,
        github_repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, "owner/repo").optional(),
        ...settingsInput,
      }),
      async execute(a, ctx) {
        const body: Record<string, unknown> = { name: a.name, ...pickSettings(a), ...(a.github_repo ? { gitRepository: { type: "github", repo: a.github_repo } } : {}) };
        const p = await call<Project>(ctx, `/v11/projects${qs(scope(ctx, a.team))}`, { method: "POST", need: "project:write", body });
        return settingsView(p);
      },
    }),
    tool({
      name: "update_project",
      description: "Change a project's build settings (framework, buildCommand, installCommand, devCommand, outputDirectory, rootDirectory, nodeVersion; null resets to the framework default). The next production build uses them, so the user approves first.",
      input: z.object({ project, team, ...settingsInput }).refine((a) => Object.keys(pickSettings(a)).length > 0, "Give at least one setting to change"),
      requiresApproval: true,
      summarize: (a) => `Change build settings of Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        const changes = Object.entries(pickSettings(a)).map(([k, v]) => `${k}: ${shown((p as Record<string, unknown>)[k])} → ${shown(v)}`);
        return { summary: `Change build settings of Vercel project ${p.name ?? a.project}`, details: { Project: String(p.name ?? a.project), Changes: changes.join("\n") }, warning: "The next deployment (including production) builds with these settings; a wrong command can break the build." };
      },
      async execute(a, ctx) {
        const p = await call<Project>(ctx, `/v9/projects/${P(a.project)}${qs(scope(ctx, a.team))}`, { method: "PATCH", need: "project:write", body: pickSettings(a) });
        return settingsView(p);
      },
    }),
    tool({
      name: "link_git_repo",
      description: "Connect (or replace) the GitHub repository a project deploys from (owner/repo). Pushes to its production branch then deploy to production, so the user approves first.",
      input: z.object({ project, team, github_repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, "owner/repo") }),
      requiresApproval: true,
      summarize: (a) => `Link ${a.github_repo} to Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        return { summary: `Link GitHub ${a.github_repo} to Vercel project ${p.name ?? a.project}`, details: { Project: String(p.name ?? a.project), "Current repository": repoOf(p), "New repository": `github: ${a.github_repo}` }, warning: "From now on, pushes to this repository's production branch deploy to production." };
      },
      async execute(a, ctx) {
        // Same endpoint the Vercel CLI uses for `vercel git connect` (packages/cli/src/util/git/connect-git-provider.ts).
        const p = await call<Project>(ctx, `/v9/projects/${P(a.project)}/link${qs(scope(ctx, a.team))}`, { method: "POST", need: "project:write", body: { type: "github", repo: a.github_repo } });
        return { project: p.name ?? a.project, gitRepository: repoOf(p) };
      },
    }),
    tool({
      name: "delete_project",
      description: "Permanently delete a Vercel project with all its deployments, domains and environment variables. The user approves the exact project first; call this instead of telling them to do it manually.",
      input: z.object({ project, team }),
      requiresApproval: true,
      summarize: (a) => `Delete Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        const d = await call<{ domains?: { name?: string }[] }>(ctx, `/v9/projects/${P(String(p.id ?? a.project))}/domains${qs(scope(ctx, a.team))}`, { need: "project:read" }).catch(() => ({ domains: [] }));
        const prod = p.targets?.production;
        return {
          summary: `Delete Vercel project ${p.name ?? a.project}`,
          details: { Project: `${p.name} (${p.id})`, Framework: shown(p.framework), Repository: repoOf(p), Domains: (d.domains ?? []).map((x) => x.name).filter(Boolean).join("\n") || "none", "Production": prod?.url ? `https://${prod.url} (${when(prod.createdAt)})` : "none" },
          warning: "This PERMANENTLY deletes the project, every deployment, its domains assignment and environment variables. Live URLs stop working. TARGET can't undo it.",
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/v9/projects/${P(a.project)}${qs(scope(ctx, a.team))}`, { method: "DELETE", need: "project:write" });
        return { deleted: a.project };
      },
    }),

    // ── Deployments ─────────────────────────────────────────────────────────────────────────────
    tool({
      name: "list_deployments",
      description: "List a project's recent deployments (newest first) with state, target, URL and commit.",
      input: z.object({ project, team, target: z.enum(["production", "preview"]).optional(), state: z.enum(["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED"]).optional(), limit: z.number().int().min(1).max(50).default(10) }),
      async execute(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        const j = await call<{ deployments?: Deployment[] }>(ctx, `/v7/deployments${qs({ projectId: p.id, target: a.target, state: a.state, limit: a.limit, ...scope(ctx, a.team) })}`, { need: "deployment:read" });
        return (j.deployments ?? []).map(depView);
      },
    }),
    tool({
      name: "create_deployment",
      description: "Create a deployment for a project, either by redeploying an existing deployment or from a GitHub ref. Target defaults to preview; production requires the user's approval.",
      input: z.object({
        project: z.string().min(1).max(100).describe("Project name or id"),
        team,
        target: z.enum(["preview", "production"]).default("preview"),
        redeploy_deployment_id: z.string().max(100).optional(),
        github: z.object({ org: z.string().max(100), repo: z.string().max(100), ref: z.string().max(200) }).optional(),
      }).refine((a) => !!a.redeploy_deployment_id !== !!a.github, "Give exactly one of redeploy_deployment_id or github"),
      requiresApproval: (a) => a.target === "production",
      summarize: (a) => `Deploy ${a.project} to ${a.target === "production" ? "PRODUCTION" : "preview"} on Vercel`,
      async prepare(a): Promise<ToolPreview> {
        return { summary: `Deploy ${a.project} to PRODUCTION on Vercel`, details: { Project: a.project, Target: "production", Source: a.github ? `github: ${a.github.org}/${a.github.repo}@${a.github.ref}` : `redeploy of ${a.redeploy_deployment_id}` }, warning: "When the build succeeds it replaces what your production domains serve." };
      },
      async execute(a, ctx) {
        const body: Record<string, unknown> = { name: a.project, project: a.project, ...(a.target === "production" ? { target: "production" } : {}) };
        if (a.redeploy_deployment_id) body.deploymentId = a.redeploy_deployment_id;
        if (a.github) body.gitSource = { type: "github", org: a.github.org, repo: a.github.repo, ref: a.github.ref };
        const d = await call<Record<string, unknown>>(ctx, `/v13/deployments${qs(scope(ctx, a.team))}`, { method: "POST", need: "deployment:write", body, timeoutMs: 30000 });
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target ?? "preview" };
      },
    }),
    tool({
      name: "redeploy",
      description: "Rebuild an existing deployment (same source). It keeps the original target unless target is given; a production redeploy asks the user first.",
      input: z.object({ deployment_id: deploymentId, team, target: z.enum(["preview", "production"]).describe("preview, or production when the original was production") }),
      requiresApproval: (a) => a.target === "production",
      summarize: (a) => `Redeploy ${a.deployment_id} to ${a.target === "production" ? "PRODUCTION" : "preview"} on Vercel`,
      async prepare(a, ctx) {
        const d = await getDeployment(ctx, a.deployment_id, a.team);
        return { summary: `Redeploy ${d.name ?? "deployment"} to PRODUCTION`, details: { ...depRows(d), "New target": "production" }, warning: "When the build succeeds it replaces what your production domains serve." };
      },
      async execute(a, ctx) {
        const d = await getDeployment(ctx, a.deployment_id, a.team);
        const body: Record<string, unknown> = { name: d.name, deploymentId: d.id ?? d.uid, ...(a.target === "production" ? { target: "production" } : {}) };
        const n = await call<Record<string, unknown>>(ctx, `/v13/deployments${qs({ forceNew: 1, ...scope(ctx, a.team) })}`, { method: "POST", need: "deployment:write", body, timeoutMs: 30000 });
        return { id: n.id, url: n.url ? `https://${n.url}` : undefined, readyState: n.readyState, target: n.target ?? "preview" };
      },
    }),
    tool({
      name: "promote_deployment",
      description: "Point production traffic (production domains) to a given deployment. Always asks the user first.",
      input: z.object({ project, deployment_id: deploymentId, team }),
      requiresApproval: true,
      summarize: (a) => `Promote ${a.deployment_id} to production on Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const [p, d] = await Promise.all([getProject(ctx, a.project, a.team), getDeployment(ctx, a.deployment_id, a.team)]);
        if (d.projectId && p.id && d.projectId !== p.id) throw new ConnectorError(`Deployment ${a.deployment_id} belongs to another project.`, 400, "invalid");
        const cur = p.targets?.production;
        return { summary: `Promote deployment to production on ${p.name ?? a.project}`, details: { Project: String(p.name ?? a.project), ...depRows(d), "Currently live": cur?.url ? `https://${cur.url} (${cur.id})` : "none" }, warning: "Your production domains switch to this deployment immediately." };
      },
      async execute(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        await call(ctx, `/v10/projects/${P(String(p.id ?? a.project))}/promote/${P(a.deployment_id)}${qs(scope(ctx, a.team))}`, { method: "POST", need: "deployment:write" });
        return { promoted: a.deployment_id, project: p.name };
      },
    }),
    tool({
      name: "rollback_deployment",
      description: "Instantly roll production back to a previous production deployment. Always asks the user first.",
      input: z.object({ project, deployment_id: deploymentId, team }),
      requiresApproval: true,
      summarize: (a) => `Roll back Vercel project ${a.project} to ${a.deployment_id}`,
      async prepare(a, ctx) {
        const [p, d] = await Promise.all([getProject(ctx, a.project, a.team), getDeployment(ctx, a.deployment_id, a.team)]);
        if (d.projectId && p.id && d.projectId !== p.id) throw new ConnectorError(`Deployment ${a.deployment_id} belongs to another project.`, 400, "invalid");
        if (d.target !== "production") throw new ConnectorError("Rollback needs a previous production deployment; use promote_deployment for a preview.", 400, "invalid");
        const cur = p.targets?.production;
        return { summary: `Roll back ${p.name ?? a.project} to an earlier production deployment`, details: { Project: String(p.name ?? a.project), "Roll back to": `${depRows(d).URL} (${depRows(d).Created})`, ...(d.meta?.githubCommitSha ? { Commit: depRows(d).Commit } : {}), "Currently live": cur?.url ? `https://${cur.url} (${cur.id})` : "none" }, warning: "Production switches back immediately, and Vercel stops auto-assigning new production deployments until you promote one." };
      },
      async execute(a, ctx) {
        const p = await getProject(ctx, a.project, a.team);
        await call(ctx, `/v1/projects/${P(String(p.id ?? a.project))}/rollback/${P(a.deployment_id)}${qs(scope(ctx, a.team))}`, { method: "POST", need: "deployment:write" });
        return { rolled_back_to: a.deployment_id, project: p.name };
      },
    }),
    tool({
      name: "cancel_deployment",
      description: "Cancel a deployment that is still queued or building (what is live doesn't change).",
      input: z.object({ deployment_id: deploymentId, team }),
      async execute(a, ctx) {
        const d = await call<Deployment>(ctx, `/v12/deployments/${P(a.deployment_id)}/cancel${qs(scope(ctx, a.team))}`, { method: "PATCH", need: "deployment:write" });
        return { id: d.uid ?? d.id ?? a.deployment_id, state: d.state ?? d.readyState };
      },
    }),
    tool({
      name: "get_deployment",
      description: "Get a deployment's status (readyState, url, target, error).",
      input: z.object({ id_or_url: z.string().min(1).max(200), team }),
      async execute(a, ctx) {
        const d = await getDeployment(ctx, a.id_or_url, a.team);
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target, errorMessage: d.errorMessage, createdAt: d.createdAt };
      },
    }),
    tool({
      name: "get_deployment_logs",
      description: "Read the latest build log lines of a deployment.",
      input: z.object({ id_or_url: z.string().min(1).max(200), team, limit: z.number().int().min(1).max(200).default(100) }),
      async execute(a, ctx) {
        const events = await call<Record<string, unknown>[]>(ctx, `/v3/deployments/${P(a.id_or_url)}/events${qs({ limit: a.limit, direction: "backward", ...scope(ctx, a.team) })}`, { need: "deployment:read" });
        return (Array.isArray(events) ? events : []).map((e) => {
          const payload = (e.payload ?? {}) as Record<string, unknown>;
          return { type: e.type, created: e.created, text: String(payload.text ?? e.text ?? "").slice(0, 500) };
        }).reverse();
      },
    }),

    // ── Environment variables (values never shown) ─────────────────────────────────────────────
    tool({
      name: "list_env_vars",
      description: "List a project's environment variables (key, type, targets). Values are never shown.",
      input: z.object({ project, team }),
      async execute(a, ctx) {
        const j = await call<{ envs?: EnvVar[] }>(ctx, `/v10/projects/${P(a.project)}/env${qs(scope(ctx, a.team))}`, { need: "project-env-vars:read" });
        return (j.envs ?? []).map(envView);
      },
    }),
    tool({
      name: "add_env_var",
      description: "Add (or overwrite, with upsert) an environment variable. Stored encrypted by default; use type sensitive for secrets nobody should read back. Takes effect on the next deployment. The value is never echoed.",
      input: z.object({
        project, team,
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,255}$/),
        value: z.string().max(65536),
        targets: z.array(z.enum(ENV_TARGETS)).min(1).max(3).default(["production", "preview", "development"]),
        type: z.enum(["encrypted", "sensitive", "plain"]).default("encrypted"),
        upsert: z.boolean().default(false).describe("Overwrite an existing variable with the same key and targets"),
        comment: z.string().max(500).optional(),
      }),
      async execute(a, ctx) {
        const body = { key: a.key, value: a.value, target: a.type === "sensitive" ? a.targets.filter((t) => t !== "development") : a.targets, type: a.type, ...(a.comment ? { comment: a.comment } : {}) };
        const r = await call<{ created?: EnvVar | EnvVar[]; failed?: { error?: { message?: string } }[] }>(ctx, `/v10/projects/${P(a.project)}/env${qs({ upsert: a.upsert ? "true" : undefined, ...scope(ctx, a.team) })}`, { method: "POST", need: "project-env-vars:write", body });
        if (r.failed?.length) throw new ConnectorError(`Vercel couldn't save ${a.key}: ${r.failed.map((f) => f.error?.message ?? "failed").join("; ")}`, 400, "invalid");
        const created = Array.isArray(r.created) ? r.created : r.created ? [r.created] : [];
        return { saved: created.map(envView), note: "Redeploy for running deployments to pick it up." };
      },
    }),
    tool({
      name: "update_env_var",
      description: "Change an existing environment variable (by id from list_env_vars): its value, targets, type or comment. Takes effect on the next deployment. The value is never echoed.",
      input: z.object({
        project, team, id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        value: z.string().max(65536).optional(), targets: z.array(z.enum(ENV_TARGETS)).min(1).max(3).optional(),
        type: z.enum(["encrypted", "sensitive", "plain"]).optional(), comment: z.string().max(500).optional(),
      }).refine((a) => a.value !== undefined || a.targets || a.type || a.comment !== undefined, "Nothing to change"),
      async execute(a, ctx) {
        const body = { ...(a.value !== undefined ? { value: a.value } : {}), ...(a.targets ? { target: a.targets } : {}), ...(a.type ? { type: a.type } : {}), ...(a.comment !== undefined ? { comment: a.comment } : {}) };
        const e = await call<EnvVar>(ctx, `/v9/projects/${P(a.project)}/env/${P(a.id)}${qs(scope(ctx, a.team))}`, { method: "PATCH", need: "project-env-vars:write", body });
        return { updated: envView(e), note: "Redeploy for running deployments to pick it up." };
      },
    }),
    tool({
      name: "delete_env_var",
      description: "Delete an environment variable (by id from list_env_vars). The user approves first.",
      input: z.object({ project, team, id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
      requiresApproval: true,
      summarize: (a) => `Delete an environment variable from Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const j = await call<{ envs?: EnvVar[] }>(ctx, `/v10/projects/${P(a.project)}/env${qs(scope(ctx, a.team))}`, { need: "project-env-vars:read" });
        const e = (j.envs ?? []).find((x) => x.id === a.id);
        if (!e) throw new ConnectorError(`No environment variable with id ${a.id} in ${a.project}.`, 404, "not_found");
        const prod = targetsOf(e).includes("production");
        return {
          summary: `Delete ${e.key} from Vercel project ${a.project}`,
          details: { Project: a.project, Variable: String(e.key), Targets: targetsOf(e).join(", ") || "unknown", Type: String(e.type ?? "unknown"), Value: "(hidden)" },
          warning: `The value can't be recovered after deletion.${prod ? " The next production deployment builds without it, which can break the live site." : ""}`,
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/v9/projects/${P(a.project)}/env/${P(a.id)}${qs(scope(ctx, a.team))}`, { method: "DELETE", need: "project-env-vars:write" });
        return { deleted: a.id };
      },
    }),

    // ── Domains ─────────────────────────────────────────────────────────────────────────────────
    tool({
      name: "list_domains",
      description: "List a project's domains (verified, redirect, git branch).",
      input: z.object({ project, team }),
      async execute(a, ctx) {
        const j = await call<{ domains?: Record<string, unknown>[] }>(ctx, `/v9/projects/${P(a.project)}/domains${qs({ limit: 100, ...scope(ctx, a.team) })}`, { need: "project:read" });
        return (j.domains ?? []).map((d) => ({ name: d.name, verified: d.verified, redirect: d.redirect ?? undefined, gitBranch: d.gitBranch ?? undefined }));
      },
    }),
    tool({
      name: "add_domain",
      description: "Add a domain to a Vercel project. This changes live routing, so it requires approval.",
      input: z.object({ project: z.string().min(1).max(100), domain: domainName, team }),
      requiresApproval: true,
      summarize: (a) => `Add domain ${a.domain} to Vercel project ${a.project}`,
      async execute(a, ctx) {
        const d = await call<Record<string, unknown>>(ctx, `/v10/projects/${P(a.project)}/domains${qs(scope(ctx, a.team))}`, { method: "POST", need: "domain:write", body: { name: a.domain } });
        return { name: d.name, verified: d.verified, verification: d.verification };
      },
    }),
    tool({
      name: "remove_domain",
      description: "Remove a domain from a project (the domain stops serving it). The user approves first.",
      input: z.object({ project, domain: domainName, team }),
      requiresApproval: true,
      summarize: (a) => `Remove domain ${a.domain} from Vercel project ${a.project}`,
      async prepare(a, ctx) {
        const d = await call<Record<string, unknown>>(ctx, `/v9/projects/${P(a.project)}/domains/${P(a.domain)}${qs(scope(ctx, a.team))}`, { need: "project:read" });
        return {
          summary: `Remove ${a.domain} from Vercel project ${a.project}`,
          details: { Project: a.project, Domain: a.domain, Verified: d.verified ? "yes" : "no", ...(d.redirect ? { Redirect: String(d.redirect) } : {}), ...(d.gitBranch ? { "Git branch": String(d.gitBranch) } : {}) },
          warning: `https://${a.domain} stops serving this project immediately.`,
        };
      },
      async execute(a, ctx) {
        await call(ctx, `/v9/projects/${P(a.project)}/domains/${P(a.domain)}${qs(scope(ctx, a.team))}`, { method: "DELETE", need: "domain:write" });
        return { removed: a.domain };
      },
    }),
    tool({
      name: "check_domain",
      description: "Check a domain's DNS configuration (misconfigured or not, the A/CNAME records Vercel recommends) and, with a project, its verification status. verify: true asks Vercel to re-check verification now.",
      input: z.object({ domain: domainName, project: project.optional(), team, verify: z.boolean().default(false) }),
      async execute(a, ctx) {
        const cfg = await call<Record<string, unknown>>(ctx, `/v6/domains/${P(a.domain)}/config${qs(scope(ctx, a.team))}`, { need: "domain:read" });
        const out: Record<string, unknown> = {
          domain: a.domain, misconfigured: cfg.misconfigured, configuredBy: cfg.configuredBy ?? null, nameservers: cfg.nameservers, current_a: cfg.aValues, current_cname: cfg.cnames,
          recommended_a: (cfg.recommendedIPv4 as { rank?: number; value?: string[] }[] | undefined)?.find((r) => r.rank === 1)?.value,
          recommended_cname: (cfg.recommendedCNAME as { rank?: number; value?: string }[] | undefined)?.find((r) => r.rank === 1)?.value, conflicts: cfg.conflicts,
        };
        if (a.project) {
          const path = `/v9/projects/${P(a.project)}/domains/${P(a.domain)}${a.verify ? "/verify" : ""}${qs(scope(ctx, a.team))}`;
          const d = await call<Record<string, unknown>>(ctx, path, { method: a.verify ? "POST" : "GET", need: "project:read" }).catch((e) => { if (e instanceof MissingScopeError) throw e; return { error: e instanceof Error ? e.message : "failed" } as Record<string, unknown>; });
          out.project_domain = { verified: d.verified, verification: d.verification, error: d.error };
        }
        return out;
      },
    }),
  ],
});
