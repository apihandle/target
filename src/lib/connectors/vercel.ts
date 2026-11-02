import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

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
 */
const API = "https://api.vercel.com";
const team = z.string().max(100).optional().describe("Team id or slug, when the project belongs to a team");

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
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}` } });

export const vercel = defineConnector({
  id: "vercel",
  name: "Vercel",
  icon: "▲",
  description: "See your Vercel projects, deploy, check deployment status and logs, and add domains.",
  auth: "oauth",
  scopes: [],
  capabilities: [
    "List projects",
    "Create preview deployments (production deployments ask you first)",
    "Check deployment status and read build logs",
    "Add a domain to a project (asks you first)",
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
    tool({
      name: "list_projects",
      description: "List Vercel projects (id, name, framework, latest production URL).",
      input: z.object({ team, search: z.string().max(100).optional() }),
      async execute(a, ctx) {
        const j = await call<{ projects?: Record<string, unknown>[] }>(ctx, `/v10/projects${qs({ limit: 20, search: a.search, ...scope(ctx, a.team) })}`);
        return (j.projects ?? []).map((p) => ({ id: p.id, name: p.name, framework: p.framework, updatedAt: p.updatedAt }));
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
      async execute(a, ctx) {
        const body: Record<string, unknown> = { name: a.project, project: a.project, ...(a.target === "production" ? { target: "production" } : {}) };
        if (a.redeploy_deployment_id) body.deploymentId = a.redeploy_deployment_id;
        if (a.github) body.gitSource = { type: "github", org: a.github.org, repo: a.github.repo, ref: a.github.ref };
        const d = await call<Record<string, unknown>>(ctx, `/v13/deployments${qs(scope(ctx, a.team))}`, { method: "POST", body, timeoutMs: 30000 });
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target ?? "preview" };
      },
    }),
    tool({
      name: "get_deployment",
      description: "Get a deployment's status (readyState, url, target, error).",
      input: z.object({ id_or_url: z.string().min(1).max(200), team }),
      async execute(a, ctx) {
        const d = await call<Record<string, unknown>>(ctx, `/v13/deployments/${encodeURIComponent(a.id_or_url)}${qs(scope(ctx, a.team))}`);
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target, errorMessage: d.errorMessage, createdAt: d.createdAt };
      },
    }),
    tool({
      name: "get_deployment_logs",
      description: "Read the latest build log lines of a deployment.",
      input: z.object({ id_or_url: z.string().min(1).max(200), team, limit: z.number().int().min(1).max(200).default(100) }),
      async execute(a, ctx) {
        const events = await call<Record<string, unknown>[]>(ctx, `/v3/deployments/${encodeURIComponent(a.id_or_url)}/events${qs({ limit: a.limit, direction: "backward", ...scope(ctx, a.team) })}`);
        return (Array.isArray(events) ? events : []).map((e) => {
          const payload = (e.payload ?? {}) as Record<string, unknown>;
          return { type: e.type, created: e.created, text: String(payload.text ?? e.text ?? "").slice(0, 500) };
        }).reverse();
      },
    }),
    tool({
      name: "add_domain",
      description: "Add a domain to a Vercel project. This changes live routing, so it requires approval.",
      input: z.object({ project: z.string().min(1).max(100), domain: z.string().regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i, "A domain like www.example.com"), team }),
      requiresApproval: true,
      summarize: (a) => `Add domain ${a.domain} to Vercel project ${a.project}`,
      async execute(a, ctx) {
        const d = await call<Record<string, unknown>>(ctx, `/v10/projects/${encodeURIComponent(a.project)}/domains${qs(scope(ctx, a.team))}`, { method: "POST", body: { name: a.domain } });
        return { name: d.name, verified: d.verified, verification: d.verification };
      },
    }),
  ],
});
