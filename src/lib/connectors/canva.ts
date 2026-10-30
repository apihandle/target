import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Canva, via the Canva Connect REST API (OAuth 2.0 + PKCE).
 *
 * The Canva MCP server (https://mcp.canva.com/mcp for waitlist clients, https://api.canva.com/connect/v1/mcp
 * for Developer Portal apps) also requires a registered Developer Portal app with a client id/secret.
 * Since that registration is needed either way, this connector calls the documented REST endpoints
 * directly, which keeps every call inside TARGET's approval / redaction pipeline.
 */
const API = "https://api.canva.com/rest/v1";
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}` } });

export const canva = defineConnector({
  id: "canva",
  name: "Canva",
  icon: "C",
  description: "Find your designs, start new ones and export them.",
  auth: "oauth",
  scopes: ["design:meta:read", "design:content:read", "design:content:write"],
  capabilities: ["Search your designs", "Create a new blank doc, whiteboard or presentation", "Export a design as PDF/PNG/JPG"],
  permissions: [
    "design:meta:read: see your designs' titles and thumbnails.",
    "design:content:read / design:content:write: read design content to export it, and create new designs.",
    "TARGET can't delete designs. Revoke access in Canva → Settings → Integrations.",
  ],
  requiredEnv: ["CANVA_OAUTH_CLIENT_ID", "CANVA_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: `${API}/oauth/token`,
    clientIdEnv: "CANVA_OAUTH_CLIENT_ID",
    clientSecretEnv: "CANVA_OAUTH_CLIENT_SECRET",
    tokenAuth: "basic",
    pkce: true,
    refreshable: true,
    async revoke(creds, env, f) {
      const id = env.CANVA_OAUTH_CLIENT_ID, secret = env.CANVA_OAUTH_CLIENT_SECRET;
      if (!id || !secret) return;
      await f(`${API}/oauth/revoke`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: creds.refresh_token ?? creds.access_token }).toString(),
      }).catch(() => undefined);
    },
  },
  docs: ["https://www.canva.dev/docs/connect/authentication/", "https://www.canva.dev/docs/connect/api-reference/", "https://www.canva.dev/docs/mcp"],
  todo: ["Brand templates / autofill are not implemented.", "Account label (needs profile:read scope, not requested)."],
  getTools: () => [
    tool({
      name: "search_designs",
      description: "Search the user's Canva designs by text.",
      input: z.object({ query: z.string().max(200).optional() }),
      async execute(a, ctx) {
        const j = await call<{ items?: Record<string, unknown>[] }>(ctx, `/designs${a.query ? `?query=${encodeURIComponent(a.query)}` : ""}`);
        return (j.items ?? []).slice(0, 25).map((d) => ({ id: d.id, title: d.title, updated_at: d.updated_at, edit_url: (d.urls as Record<string, unknown> | undefined)?.edit_url }));
      },
    }),
    tool({
      name: "create_design",
      description: "Create a new blank Canva design.",
      input: z.object({ title: z.string().min(1).max(255), type: z.enum(["doc", "whiteboard", "presentation"]).default("presentation") }),
      async execute(a, ctx) {
        const j = await call<{ design?: Record<string, unknown> }>(ctx, "/designs", { method: "POST", body: { design_type: { type: "preset", name: a.type }, title: a.title } });
        return { id: j.design?.id, title: j.design?.title, edit_url: (j.design?.urls as Record<string, unknown> | undefined)?.edit_url };
      },
    }),
    tool({
      name: "export_design",
      description: "Export a design and return temporary download URLs.",
      input: z.object({ design_id: z.string().min(3).max(100), format: z.enum(["pdf", "png", "jpg"]).default("pdf") }),
      async execute(a, ctx) {
        const start = await call<{ job?: { id?: string; status?: string } }>(ctx, "/exports", { method: "POST", body: { design_id: a.design_id, format: { type: a.format } } });
        const id = start.job?.id;
        if (!id) return { status: "failed" };
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const j = await call<{ job?: { status?: string; urls?: string[]; error?: unknown } }>(ctx, `/exports/${encodeURIComponent(id)}`);
          if (j.job?.status === "success") return { status: "success", urls: j.job.urls };
          if (j.job?.status === "failed") return { status: "failed", error: j.job.error };
        }
        return { status: "in_progress", job_id: id, note: "Export still running; ask again shortly." };
      },
    }),
  ],
});
