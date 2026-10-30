import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Vercel, via the official REST API (https://api.vercel.com).
 *
 * Why REST and not the hosted MCP server (https://mcp.vercel.com): Vercel's MCP server only accepts
 * AI clients that Vercel has reviewed and allow-listed (https://vercel.com/docs/agent-resources/vercel-mcp),
 * so a self-hosted app like TARGET can't complete its OAuth flow. The REST API accepts a per-user
 * access token, which is what this connector stores (encrypted).
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
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}` } });

export const vercel = defineConnector({
  id: "vercel",
  name: "Vercel",
  icon: "▲",
  description: "See your Vercel projects, deploy, check deployment status and logs, and add domains.",
  auth: "api_key",
  scopes: [],
  capabilities: [
    "List projects",
    "Create preview deployments (production deployments ask you first)",
    "Check deployment status and read build logs",
    "Add a domain to a project (asks you first)",
  ],
  permissions: [
    "Uses a Vercel access token. Vercel tokens act with your account's permissions on the scope you pick when creating it (personal account or one team).",
    "Pick the narrowest scope and an expiry date when you create the token.",
    "The token is encrypted on TARGET's server and never shown again. Delete it in Vercel → Account Settings → Tokens to cut access completely.",
  ],
  requiredEnv: [],
  apiKey: {
    label: "Vercel access token",
    helpUrl: "https://vercel.com/account/settings/tokens",
    helpText: "Vercel → Account Settings → Tokens → Create. Choose the scope (account or team) and an expiration.",
    async validate(key, f) {
      if (key.length < 20 || /\s/.test(key)) throw new ConnectorError("That doesn't look like a Vercel access token.", 400, "invalid");
      try {
        const j = await apiFetch<{ user?: { username?: string } }>(`${API}/v2/user`, { f, headers: { Authorization: `Bearer ${key}` } });
        return { accountLabel: j.user?.username ? `@${j.user.username}` : "Vercel account" };
      } catch (e) {
        if (e instanceof ConnectorError && e.code === "auth") throw new ConnectorError("Vercel rejected that token.", 400, "invalid");
        throw e;
      }
    },
  },
  docs: [
    "https://vercel.com/docs/rest-api",
    "https://openapi.vercel.sh/",
    "https://vercel.com/docs/agent-resources/vercel-mcp",
  ],
  todo: ["OAuth (“Sign in with Vercel” / Vercel integration) instead of a pasted token. Needs an app registered with Vercel."],
  getTools: () => [
    tool({
      name: "list_projects",
      description: "List Vercel projects (id, name, framework, latest production URL).",
      input: z.object({ team, search: z.string().max(100).optional() }),
      async execute(a, ctx) {
        const j = await call<{ projects?: Record<string, unknown>[] }>(ctx, `/v10/projects${qs({ limit: 20, search: a.search, ...teamQ(a.team) })}`);
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
        const d = await call<Record<string, unknown>>(ctx, `/v13/deployments${qs(teamQ(a.team))}`, { method: "POST", body, timeoutMs: 30000 });
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target ?? "preview" };
      },
    }),
    tool({
      name: "get_deployment",
      description: "Get a deployment's status (readyState, url, target, error).",
      input: z.object({ id_or_url: z.string().min(1).max(200), team }),
      async execute(a, ctx) {
        const d = await call<Record<string, unknown>>(ctx, `/v13/deployments/${encodeURIComponent(a.id_or_url)}${qs(teamQ(a.team))}`);
        return { id: d.id, url: d.url ? `https://${d.url}` : undefined, readyState: d.readyState, target: d.target, errorMessage: d.errorMessage, createdAt: d.createdAt };
      },
    }),
    tool({
      name: "get_deployment_logs",
      description: "Read the latest build log lines of a deployment.",
      input: z.object({ id_or_url: z.string().min(1).max(200), team, limit: z.number().int().min(1).max(200).default(100) }),
      async execute(a, ctx) {
        const events = await call<Record<string, unknown>[]>(ctx, `/v3/deployments/${encodeURIComponent(a.id_or_url)}/events${qs({ limit: a.limit, direction: "backward", ...teamQ(a.team) })}`);
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
        const d = await call<Record<string, unknown>>(ctx, `/v10/projects/${encodeURIComponent(a.project)}/domains${qs(teamQ(a.team))}`, { method: "POST", body: { name: a.domain } });
        return { name: d.name, verified: d.verified, verification: d.verification };
      },
    }),
  ],
});
