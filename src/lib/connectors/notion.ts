import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/** Notion, via the public REST API with a public-connection OAuth token. */
const API = "https://api.notion.com/v1";
// TODO: move to a newer Notion-Version (2025-09-03+ changes databases to data sources); 2022-06-28 is still accepted.
const VERSION = "2022-06-28";
const call = <T = unknown>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}`, "Notion-Version": VERSION } });
const pageId = z.string().transform((s) => s.replace(/-/g, "").slice(-32)).pipe(z.string().regex(/^[0-9a-f]{32}$/i, "A Notion page id or URL"));

type RichText = { plain_text?: string }[];
const plain = (rt: RichText | undefined) => (rt ?? []).map((t) => t.plain_text ?? "").join("");
function titleOf(p: Record<string, unknown>): string {
  for (const v of Object.values((p.properties ?? {}) as Record<string, { type?: string; title?: RichText }>)) if (v?.type === "title") return plain(v.title);
  return "";
}

export const notion = defineConnector({
  id: "notion",
  name: "Notion",
  icon: "N",
  description: "Search and read the Notion pages you share with TARGET, and create new pages.",
  auth: "oauth",
  scopes: [],
  capabilities: ["Search pages you shared", "Read a page's text", "Create a page under a page you shared"],
  permissions: [
    "Notion asks you which pages to share with TARGET. It can only see and edit those pages (and their children).",
    "Capabilities (read/insert content) are set on the Notion connection by the server owner.",
    "Remove access any time in Notion → Settings → Connections.",
  ],
  requiredEnv: ["NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: `${API}/oauth/authorize`,
    tokenUrl: `${API}/oauth/token`,
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
    tokenAuth: "basic",
    tokenBody: "json",
    extraAuthorizeParams: { owner: "user" },
    refreshable: true,
    async accountLabel(_t, j) {
      return typeof j.workspace_name === "string" ? `Workspace: ${j.workspace_name}` : "";
    },
    async revoke(creds, env, f) {
      const id = env.NOTION_OAUTH_CLIENT_ID, secret = env.NOTION_OAUTH_CLIENT_SECRET;
      if (!id || !secret) return;
      await f(`${API}/oauth/revoke`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/json", "Notion-Version": VERSION },
        body: JSON.stringify({ token: creds.access_token }),
      }).catch(() => undefined);
    },
  },
  docs: ["https://developers.notion.com/docs/authorization", "https://developers.notion.com/reference/revoke-token", "https://developers.notion.com/reference/post-search"],
  todo: ["Database rows / data sources are not queried; only pages.", "Rich formatting is flattened to plain text."],
  getTools: () => [
    tool({
      name: "search",
      description: "Search Notion pages shared with TARGET by title.",
      input: z.object({ query: z.string().max(200).default("") }),
      async execute(a, ctx) {
        const j = await call<{ results?: Record<string, unknown>[] }>(ctx, "/search", { method: "POST", body: { query: a.query, filter: { property: "object", value: "page" }, page_size: 20 } });
        return (j.results ?? []).map((p) => ({ id: p.id, title: titleOf(p), url: p.url, last_edited_time: p.last_edited_time }));
      },
    }),
    tool({
      name: "read_page",
      description: "Read a Notion page's title and text content.",
      input: z.object({ page_id: pageId }),
      async execute(a, ctx) {
        const page = await call<Record<string, unknown>>(ctx, `/pages/${a.page_id}`);
        const blocks = await call<{ results?: Record<string, unknown>[] }>(ctx, `/blocks/${a.page_id}/children?page_size=100`);
        const lines = (blocks.results ?? []).map((b) => {
          const v = b[String(b.type)] as { rich_text?: RichText } | undefined;
          return plain(v?.rich_text);
        }).filter(Boolean);
        return { title: titleOf(page), url: page.url, content: clip(lines.join("\n"), 20000) };
      },
    }),
    tool({
      name: "create_page",
      description: "Create a page (title + paragraphs) under a parent page shared with TARGET.",
      input: z.object({ parent_page_id: pageId, title: z.string().min(1).max(200), content: z.string().max(20000).default("") }),
      async execute(a, ctx) {
        const paragraphs = a.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 90)
          .map((p) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 2000) } }] } }));
        const p = await call<Record<string, unknown>>(ctx, "/pages", { method: "POST", body: { parent: { page_id: a.parent_page_id }, properties: { title: { title: [{ text: { content: a.title } }] } }, children: paragraphs } });
        return { id: p.id, url: p.url };
      },
    }),
  ],
});
