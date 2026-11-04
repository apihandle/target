import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Figma, via the REST API (https://developers.figma.com/docs/rest-api/). Two ways to connect:
 *  - OAuth app (when FIGMA_OAUTH_CLIENT_ID / FIGMA_OAUTH_CLIENT_SECRET are set): Bearer token, refreshed at
 *    POST /v1/oauth/refresh (https://developers.figma.com/docs/rest-api/oauth-apps/).
 *  - Personal access token (always available): sent as X-Figma-Token.
 *
 * Why not the hosted MCP server (https://mcp.figma.com/mcp): it only accepts clients in the Figma MCP catalog and does
 * not accept personal access tokens (https://developers.figma.com/docs/figma-mcp-server/mcp-clients-issues/).
 */
const API = "https://api.figma.com/v1";
const fileKey = z.string().min(5).max(300).describe("Figma file key, or a figma.com/design/... or /file/... URL").transform((s) => {
  const m = s.match(/figma\.com\/(?:file|design|proto|board|slides)\/([A-Za-z0-9]+)/);
  return m ? m[1] : s;
}).pipe(z.string().regex(/^[A-Za-z0-9]{5,64}$/, "Not a Figma file key"));
const nodeIds = z.array(z.string().regex(/^-?[0-9]+[:-][0-9]+(;-?[0-9]+[:-][0-9]+)*$/)).max(50);
const numId = (what: string) => z.string().regex(/^[0-9]{1,30}$/, `A Figma ${what} id (digits, from its URL)`);
const teamId = numId("team").describe("Team id: the digits after /team/ in a figma.com/files/team/<id>/... URL");

/** OAuth tokens are Bearer; personal access tokens use X-Figma-Token (https://developers.figma.com/docs/rest-api/authentication/). */
const authHeaders = (ctx: ToolContext): Record<string, string> =>
  ctx.meta?.auth === "oauth" ? { Authorization: `Bearer ${ctx.token}` } : { "X-Figma-Token": ctx.token };
const get = <T = Record<string, unknown>>(ctx: ToolContext, path: string) => apiFetch<T>(`${API}${path}`, { f: ctx.fetch, headers: authHeaders(ctx) });
const ids = (n: string[]) => n.map((x) => x.replace("-", ":")).join(",");

type Comment = { id?: string; message?: string; parent_id?: string; created_at?: string; resolved_at?: string | null; user?: { handle?: string }; client_meta?: { node_id?: string } };
type Comp = { key?: string; name?: string; description?: string; node_id?: string; file_key?: string; containing_frame?: { name?: string; pageName?: string }; style_type?: string; updated_at?: string };
const compOut = (c: Comp) => ({ key: c.key, name: c.name, ...(c.style_type ? { type: c.style_type } : {}), description: c.description || undefined, node_id: c.node_id, file_key: c.file_key, frame: c.containing_frame?.name, page: c.containing_frame?.pageName });

export const figma = defineConnector({
  id: "figma",
  name: "Figma",
  icon: "F",
  description: "Browse your Figma projects and files, read design structure, export images, list components and styles, and read or post comments (posting asks you first).",
  auth: "api_key",
  scopes: ["current_user:read", "file_content:read", "file_metadata:read", "file_comments:read", "file_comments:write", "projects:read", "library_content:read", "team_library_content:read"],
  capabilities: [
    "List a team's projects and each project's files",
    "Read a file's or frame's design tree; export frames as PNG/JPG/SVG/PDF",
    "List a file's or team's published components and styles",
    "Read comments; post a comment or reply (asks you first)",
  ],
  permissions: [
    "Read scopes: current_user, file_content, file_metadata, projects, library_content, team_library_content, file_comments.",
    "file_comments:write: post comments. Every comment waits for your approval. TARGET never edits your designs.",
    "Revoke a token in Figma → Settings → Security, or remove the app under Settings → Connected apps.",
  ],
  requiredEnv: [],
  oauth: {
    authorizeUrl: "https://www.figma.com/oauth",
    tokenUrl: `${API}/oauth/token`,
    refreshUrl: `${API}/oauth/refresh`,
    clientIdEnv: "FIGMA_OAUTH_CLIENT_ID",
    clientSecretEnv: "FIGMA_OAUTH_CLIENT_SECRET",
    tokenAuth: "basic",
    pkce: true,
    scopeSeparator: ",",
    refreshable: true,
    parseToken: () => ({ meta: { auth: "oauth" } }),
    async accountLabel(token, _j, f) {
      const me = await apiFetch<{ handle?: string; email?: string }>(`${API}/me`, { f, headers: { Authorization: `Bearer ${token}` } });
      return me.handle ?? me.email ?? "";
    },
  },
  apiKey: {
    label: "Figma personal access token",
    placeholder: "figd_…",
    helpUrl: "https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens",
    helpText: "Figma → Settings → Security → Generate new token. Give it read access to File content, File metadata, Projects, Library content, Team library content, Current user, and read + write for Comments, with an expiry.",
    async validate(key, f) {
      if (key.length < 20 || /\s/.test(key)) throw new ConnectorError("That doesn't look like a Figma personal access token.", 400, "invalid");
      try {
        const me = await apiFetch<{ handle?: string }>(`${API}/me`, { f, headers: { "X-Figma-Token": key } });
        return { accountLabel: me.handle ? me.handle : "Figma account", meta: { auth: "pat" } };
      } catch (e) {
        if (e instanceof ConnectorError && e.code === "auth") throw new ConnectorError("Figma rejected that token (it needs the current_user:read scope).", 400, "invalid");
        throw e;
      }
    },
  },
  docs: [
    "https://developers.figma.com/docs/rest-api/", "https://developers.figma.com/docs/rest-api/oauth-apps/", "https://developers.figma.com/docs/rest-api/scopes/",
    "https://developers.figma.com/docs/rest-api/projects-endpoints/", "https://developers.figma.com/docs/rest-api/comments-endpoints/",
    "https://developers.figma.com/docs/rest-api/component-endpoints/", "https://developers.figma.com/docs/figma-mcp-server/",
  ],
  todo: ["Owner (optional): create a Figma OAuth app with the scopes above and set FIGMA_OAUTH_CLIENT_ID / FIGMA_OAUTH_CLIENT_SECRET. Personal access tokens work without it."],
  getTools: () => [
    tool({
      name: "list_projects",
      description: "List the projects in a Figma team (Figma's API has no 'all my teams' call, so it needs the team id from a team URL).",
      input: z.object({ team_id: teamId }),
      async execute(a, ctx) {
        const j = await get<{ name?: string; projects?: { id?: string | number; name?: string }[] }>(ctx, `/teams/${a.team_id}/projects`);
        return { team: j.name, projects: (j.projects ?? []).map((p) => ({ id: String(p.id), name: p.name })) };
      },
    }),
    tool({
      name: "list_files",
      description: "List the files in a Figma project (key, name, last modified, thumbnail).",
      input: z.object({ project_id: numId("project") }),
      async execute(a, ctx) {
        const j = await get<{ name?: string; files?: { key?: string; name?: string; last_modified?: string; thumbnail_url?: string }[] }>(ctx, `/projects/${a.project_id}/files`);
        return { project: j.name, files: (j.files ?? []).map((f) => ({ key: f.key, name: f.name, last_modified: f.last_modified, url: f.key ? `https://www.figma.com/design/${f.key}` : undefined })) };
      },
    }),
    tool({
      name: "get_design_context",
      description: "Get the design tree of a Figma file or of specific frames/nodes (names, types, layout, text, styles).",
      input: z.object({ file: fileKey, node_ids: nodeIds.optional(), depth: z.number().int().min(1).max(4).default(2) }),
      async execute(a, ctx) {
        if (a.node_ids?.length) return get(ctx, `/files/${a.file}/nodes?ids=${encodeURIComponent(ids(a.node_ids))}&depth=${a.depth}`);
        const j = await get(ctx, `/files/${a.file}?depth=${a.depth}`);
        return { name: j.name, lastModified: j.lastModified, document: j.document, components: j.components, styles: j.styles };
      },
    }),
    tool({
      name: "get_screenshot",
      description: "Export frames/nodes as images (PNG, JPG, SVG or PDF) and return temporary image URLs.",
      input: z.object({ file: fileKey, node_ids: nodeIds.min(1), format: z.enum(["png", "jpg", "svg", "pdf"]).default("png"), scale: z.number().min(0.01).max(4).default(1) }),
      async execute(a, ctx) {
        const j = await get<{ images?: Record<string, string | null>; err?: string | null }>(ctx, `/images/${a.file}?ids=${encodeURIComponent(ids(a.node_ids))}&format=${a.format}&scale=${a.scale}`);
        if (j.err) throw new ConnectorError(`Figma couldn't render that: ${j.err}`, 400, "invalid");
        return { images: j.images ?? {}, note: "Image URLs are temporary (Figma deletes them after up to 30 days)." };
      },
    }),
    tool({
      name: "list_comments",
      description: "List the comments on a Figma file (newest first), with replies' parent ids and whether resolved.",
      input: z.object({ file: fileKey, include_resolved: z.boolean().default(false) }),
      async execute(a, ctx) {
        const j = await get<{ comments?: Comment[] }>(ctx, `/files/${a.file}/comments?as_md=true`);
        return (j.comments ?? []).filter((c) => a.include_resolved || !c.resolved_at).slice(0, 200).map((c) => ({
          id: c.id, message: c.message, author: c.user?.handle, created_at: c.created_at, ...(c.parent_id ? { reply_to: c.parent_id } : {}), ...(c.client_meta?.node_id ? { node_id: c.client_meta.node_id } : {}), ...(c.resolved_at ? { resolved_at: c.resolved_at } : {}),
        }));
      },
    }),
    tool({
      name: "post_comment",
      description: "Post a comment on a Figma file, pinned to a node (frame) if given, or reply to a root comment. Always requires the user's approval.",
      input: z.object({ file: fileKey, message: z.string().min(1).max(5000), node_id: z.string().regex(/^[0-9]+[:-][0-9]+$/).optional(), reply_to: z.string().regex(/^[0-9]{1,30}$/).optional().describe("Root comment id to reply to") })
        .refine((a) => !(a.node_id && a.reply_to), "A reply can't be pinned to a node"),
      requiresApproval: true,
      summarize: (a) => `Post a Figma comment on file ${a.file}`,
      async prepare(a, ctx) {
        const meta = await get<{ name?: string; file?: { name?: string } }>(ctx, `/files/${a.file}/meta`).catch(async (e) => {
          if (e instanceof ConnectorError && e.code === "not_found") throw e;
          return get<{ name?: string; file?: { name?: string } }>(ctx, `/files/${a.file}?depth=1`);
        });
        const name = meta.file?.name ?? meta.name ?? a.file;
        return { summary: `${a.reply_to ? "Reply to a comment" : "Post a comment"} on Figma file "${name}"`, details: { File: String(name), ...(a.node_id ? { Frame: a.node_id } : {}), ...(a.reply_to ? { "Reply to": a.reply_to } : {}), Comment: a.message }, warning: "Everyone with access to the file will see this comment under your name." };
      },
      async execute(a, ctx) {
        const body = { message: a.message, ...(a.reply_to ? { comment_id: a.reply_to } : {}), ...(a.node_id ? { client_meta: { node_id: a.node_id.replace("-", ":"), node_offset: { x: 0, y: 0 } } } : {}) };
        const c = await apiFetch<Comment>(`${API}/files/${a.file}/comments`, { method: "POST", f: ctx.fetch, headers: authHeaders(ctx), body });
        return { posted: true, id: c.id, created_at: c.created_at };
      },
    }),
    tool({
      name: "list_components",
      description: "List published components (and component sets) in a file, or across a team library (give team_id).",
      input: z.object({ file: fileKey.optional(), team_id: teamId.optional(), limit: z.number().int().min(1).max(1000).default(100) }).refine((a) => !!a.file !== !!a.team_id, "Give file or team_id"),
      async execute(a, ctx) {
        if (a.file) {
          const [c, s] = await Promise.all([
            get<{ meta?: { components?: Comp[] } }>(ctx, `/files/${a.file}/components`),
            get<{ meta?: { component_sets?: Comp[] } }>(ctx, `/files/${a.file}/component_sets`).catch(() => ({ meta: { component_sets: [] as Comp[] } })),
          ]);
          return { components: (c.meta?.components ?? []).slice(0, a.limit).map(compOut), component_sets: (s.meta?.component_sets ?? []).slice(0, a.limit).map(compOut) };
        }
        const j = await get<{ meta?: { components?: Comp[] } }>(ctx, `/teams/${a.team_id}/components?page_size=${Math.min(a.limit, 1000)}`);
        return { components: (j.meta?.components ?? []).map(compOut) };
      },
    }),
    tool({
      name: "list_styles",
      description: "List published styles (colors, text, effects, grids) in a file, or across a team library (give team_id).",
      input: z.object({ file: fileKey.optional(), team_id: teamId.optional(), limit: z.number().int().min(1).max(1000).default(100) }).refine((a) => !!a.file !== !!a.team_id, "Give file or team_id"),
      async execute(a, ctx) {
        const j = await get<{ meta?: { styles?: Comp[] } }>(ctx, a.file ? `/files/${a.file}/styles` : `/teams/${a.team_id}/styles?page_size=${Math.min(a.limit, 1000)}`);
        return { styles: (j.meta?.styles ?? []).slice(0, a.limit).map(compOut) };
      },
    }),
  ],
});
