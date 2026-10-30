import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";

/**
 * Figma, via the REST API (https://api.figma.com) with a personal access token.
 *
 * Why not the hosted MCP server (https://mcp.figma.com/mcp): Figma's remote MCP server only accepts
 * clients listed in the Figma MCP catalog and does not accept personal access tokens
 * (https://developers.figma.com/docs/figma-mcp-server/mcp-clients-issues/), so a self-hosted app can't
 * use it. The REST API provides the design data (file/node JSON) and rendered images.
 */
const API = "https://api.figma.com/v1";
const fileKey = z.string().min(5).max(300).describe("Figma file key, or a figma.com/design/... or /file/... URL").transform((s) => {
  const m = s.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  return m ? m[1] : s;
}).pipe(z.string().regex(/^[A-Za-z0-9]{5,64}$/, "Not a Figma file key"));
const nodeIds = z.array(z.string().regex(/^[0-9]+[:-][0-9]+(;[0-9]+[:-][0-9]+)*$/)).max(20);

export const figma = defineConnector({
  id: "figma",
  name: "Figma",
  icon: "F",
  description: "Read design structure (frames, components, text, styles) and render screenshots of frames.",
  auth: "api_key",
  scopes: ["file_content:read", "current_user:read"],
  capabilities: ["Read a file's or frame's design context", "Render screenshots (PNG) of frames"],
  permissions: [
    "Uses a Figma personal access token with read-only scopes: file_content:read and current_user:read.",
    "It can read any file your Figma account can open. It can't edit files.",
    "Revoke it any time in Figma → Settings → Security → Personal access tokens.",
  ],
  requiredEnv: [],
  apiKey: {
    label: "Figma personal access token",
    placeholder: "figd_…",
    helpUrl: "https://www.figma.com/developers/api#access-tokens",
    helpText: "Figma → Settings → Security → Generate new token. Give it only “File content: read” and “Current user: read”, and an expiry.",
    async validate(key, f) {
      if (key.length < 20 || /\s/.test(key)) throw new ConnectorError("That doesn't look like a Figma personal access token.", 400, "invalid");
      try {
        const me = await apiFetch<{ handle?: string }>(`${API}/me`, { f, headers: { "X-Figma-Token": key } });
        return { accountLabel: me.handle ? me.handle : "Figma account" };
      } catch (e) {
        if (e instanceof ConnectorError && e.code === "auth") throw new ConnectorError("Figma rejected that token (it needs the current_user:read scope).", 400, "invalid");
        throw e;
      }
    },
  },
  docs: ["https://www.figma.com/developers/api", "https://developers.figma.com/docs/figma-mcp-server/"],
  todo: ["Figma OAuth app (needs app registration with Figma) instead of a personal access token.", "Code Connect / variables data are not fetched."],
  getTools: () => [
    tool({
      name: "get_design_context",
      description: "Get the design tree of a Figma file or of specific frames/nodes (names, types, layout, text, styles).",
      input: z.object({ file: fileKey, node_ids: nodeIds.optional(), depth: z.number().int().min(1).max(4).default(2) }),
      async execute(a, ctx) {
        const h = { "X-Figma-Token": ctx.token };
        if (a.node_ids?.length) {
          const ids = a.node_ids.map((n) => n.replace("-", ":")).join(",");
          return apiFetch(`${API}/files/${a.file}/nodes?ids=${encodeURIComponent(ids)}&depth=${a.depth}`, { f: ctx.fetch, headers: h });
        }
        const j = await apiFetch<Record<string, unknown>>(`${API}/files/${a.file}?depth=${a.depth}`, { f: ctx.fetch, headers: h });
        return { name: j.name, lastModified: j.lastModified, document: j.document, components: j.components, styles: j.styles };
      },
    }),
    tool({
      name: "get_screenshot",
      description: "Render frames/nodes as images and return temporary image URLs.",
      input: z.object({ file: fileKey, node_ids: nodeIds.min(1), format: z.enum(["png", "jpg", "svg"]).default("png"), scale: z.number().min(0.1).max(4).default(1) }),
      async execute(a, ctx) {
        const ids = a.node_ids.map((n) => n.replace("-", ":")).join(",");
        const j = await apiFetch<{ images?: Record<string, string | null>; err?: string | null }>(`${API}/images/${a.file}?ids=${encodeURIComponent(ids)}&format=${a.format}&scale=${a.scale}`, { f: ctx.fetch, headers: { "X-Figma-Token": ctx.token } });
        return { images: j.images ?? {}, note: "Image URLs are temporary (they expire after a while)." };
      },
    }),
  ],
});
