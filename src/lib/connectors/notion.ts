import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Notion, via the public REST API (https://developers.notion.com/reference) with a public-connection OAuth token.
 * Notion-Version 2022-06-28: databases are queried with POST /v1/databases/:id/query and rows are pages whose parent
 * is { database_id }. (2025-09-03 moves this to "data sources"; 2022-06-28 is still accepted.)
 * TARGET only sees pages and databases the user shared with the connection in Notion's consent screen.
 */
const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
type Json = Record<string, unknown>;
const call = <T = Json>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}`, "Notion-Version": VERSION } });

/** A Notion id (with or without dashes) or a notion.so / notion.site URL that ends in one. */
const notionId = (what: string) => z.string().min(32).max(500).transform((s) => {
  const clean = s.split(/[?#]/)[0].replace(/-/g, "");
  const m = clean.match(/([0-9a-f]{32})$/i);
  return m ? m[1].toLowerCase() : clean;
}).pipe(z.string().regex(/^[0-9a-f]{32}$/i, `A Notion ${what} id or URL`));
const pageId = notionId("page");
const databaseId = notionId("database");
const blockId = notionId("block or page");

type RichText = { plain_text?: string; href?: string | null }[];
const plain = (rt: RichText | undefined) => (rt ?? []).map((t) => t.plain_text ?? "").join("");
const rich = (s: string) => {
  // Notion caps one text object at 2000 characters.
  const out: Json[] = [];
  for (let i = 0; i < s.length || i === 0; i += 2000) out.push({ type: "text", text: { content: s.slice(i, i + 2000) } });
  return out.slice(0, 100);
};

function titleOf(p: Json): string {
  if (Array.isArray(p.title)) return plain(p.title as RichText); // databases
  for (const v of Object.values((p.properties ?? {}) as Record<string, { type?: string; title?: RichText }>)) if (v?.type === "title") return plain(v.title);
  return "";
}

/** A property value as plain JSON the model can read. */
function simplify(v: Json): unknown {
  const t = String(v.type);
  const x = v[t] as unknown;
  switch (t) {
    case "title": case "rich_text": return plain(x as RichText);
    case "number": case "checkbox": case "url": case "email": case "phone_number": case "created_time": case "last_edited_time": return x;
    case "select": case "status": return (x as { name?: string } | null)?.name ?? null;
    case "multi_select": return ((x as { name?: string }[]) ?? []).map((o) => o.name);
    case "date": { const d = x as { start?: string; end?: string | null } | null; return d ? (d.end ? `${d.start} → ${d.end}` : d.start) : null; }
    case "people": return ((x as { name?: string; id?: string }[]) ?? []).map((p) => p.name ?? p.id);
    case "relation": return ((x as { id?: string }[]) ?? []).map((r) => r.id);
    case "files": return ((x as { name?: string }[]) ?? []).map((f) => f.name);
    case "formula": { const f = x as Json; return f?.[String(f?.type)] ?? null; }
    case "rollup": { const r = x as Json; return r?.type === "array" ? (r.array as Json[]).map(simplify) : r?.[String(r?.type)] ?? null; }
    case "unique_id": { const u = x as { prefix?: string; number?: number }; return u ? `${u.prefix ? `${u.prefix}-` : ""}${u.number}` : null; }
    case "created_by": case "last_edited_by": return (x as { name?: string; id?: string })?.name ?? (x as { id?: string })?.id;
    default: return x ?? null;
  }
}
const props = (p: Json) => Object.fromEntries(Object.entries((p.properties ?? {}) as Record<string, Json>).map(([k, v]) => [k, simplify(v)]));
const rowOut = (p: Json) => ({ id: p.id, url: p.url, last_edited_time: p.last_edited_time, properties: props(p) });

type Schema = Record<string, { type?: string }>;
/**
 * Turn simple values ({ Status: "Done", Due: "2026-11-05", Tags: ["a","b"] }) into Notion property JSON using the
 * database schema. Unknown property names are refused rather than silently dropped.
 */
export function toNotionProps(schema: Schema, values: Record<string, unknown>): Json {
  const out: Json = {};
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  for (const [name, v] of Object.entries(values)) {
    const type = schema[name]?.type;
    if (!type) throw new ConnectorError(`"${name}" isn't a property here. Properties: ${Object.keys(schema).join(", ")}`.slice(0, 380), 400, "invalid");
    switch (type) {
      case "title": out[name] = { title: rich(str(v)) }; break;
      case "rich_text": out[name] = { rich_text: rich(str(v)) }; break;
      case "number": { const n = v === null || v === "" ? null : Number(v); if (n !== null && !Number.isFinite(n)) throw new ConnectorError(`"${name}" needs a number`, 400, "invalid"); out[name] = { number: n }; break; }
      case "checkbox": out[name] = { checkbox: v === true || /^(true|yes|1|done|x)$/i.test(str(v)) }; break;
      case "select": out[name] = { select: str(v) ? { name: str(v) } : null }; break;
      case "status": out[name] = { status: str(v) ? { name: str(v) } : null }; break;
      case "multi_select": out[name] = { multi_select: (Array.isArray(v) ? v : str(v).split(",")).map((s) => String(s).trim()).filter(Boolean).map((n) => ({ name: n })) }; break;
      case "date": {
        if (!str(v)) { out[name] = { date: null }; break; }
        const [start, end] = Array.isArray(v) ? v.map(String) : str(v).split(/\s*(?:→|\.\.)\s*/);
        out[name] = { date: { start, ...(end ? { end } : {}) } }; break;
      }
      case "url": out[name] = { url: str(v) || null }; break;
      case "email": out[name] = { email: str(v) || null }; break;
      case "phone_number": out[name] = { phone_number: str(v) || null }; break;
      case "people": out[name] = { people: (Array.isArray(v) ? v : [v]).filter(Boolean).map((id) => ({ id: String(id) })) }; break;
      case "relation": out[name] = { relation: (Array.isArray(v) ? v : [v]).filter(Boolean).map((id) => ({ id: String(id).replace(/-/g, "") })) }; break;
      default: throw new ConnectorError(`"${name}" (${type}) can't be set with a simple value; pass it in properties as Notion JSON.`, 400, "invalid");
    }
  }
  return out;
}

/**
 * Markdown-ish text → Notion blocks: # / ## / ### headings, - or * bullets, 1. numbered, [ ] / [x] to-dos, > quotes,
 * ``` fenced code, --- dividers, everything else paragraphs (blank line separated).
 */
export function textToBlocks(text: string): Json[] {
  const blocks: Json[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const block = (type: string, s: string, extra: Json = {}) => ({ object: "block", type, [type]: { rich_text: rich(s), ...extra } });
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push(block("paragraph", para.join("\n"))); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push(block("code", code.join("\n"), { language: fence[1] || "plain text" }));
      continue;
    }
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); blocks.push(block(`heading_${m[1].length}`, m[2])); continue; }
    if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)) || (m = line.match(/^\s*\[( |x|X)\]\s+(.*)$/))) { flush(); blocks.push(block("to_do", m[2], { checked: m[1].toLowerCase() === "x" })); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flush(); blocks.push(block("bulleted_list_item", m[1])); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); blocks.push(block("numbered_list_item", m[1])); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); blocks.push(block("quote", m[1])); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); blocks.push({ object: "block", type: "divider", divider: {} }); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Blocks → readable text (one line per block, Markdown-ish prefixes). */
function blockLine(b: Json): string {
  const t = String(b.type);
  const v = b[t] as { rich_text?: RichText; checked?: boolean; title?: string; language?: string; url?: string } | undefined;
  const txt = plain(v?.rich_text);
  switch (t) {
    case "heading_1": return `# ${txt}`;
    case "heading_2": return `## ${txt}`;
    case "heading_3": return `### ${txt}`;
    case "bulleted_list_item": return `- ${txt}`;
    case "numbered_list_item": return `1. ${txt}`;
    case "to_do": return `[${v?.checked ? "x" : " "}] ${txt}`;
    case "quote": return `> ${txt}`;
    case "code": return "```" + (v?.language ?? "") + "\n" + txt + "\n```";
    case "divider": return "---";
    case "child_page": return `[page] ${v?.title ?? ""} (${b.id})`;
    case "child_database": return `[database] ${v?.title ?? ""} (${b.id})`;
    case "image": case "file": case "pdf": case "video": case "bookmark": case "embed": return `[${t}] ${v?.url ?? ""}`.trim();
    default: return txt;
  }
}

const values = z.record(z.string(), z.unknown()).describe("Simple values by property name, e.g. {\"Status\":\"Done\",\"Due\":\"2026-11-05\",\"Tags\":[\"a\",\"b\"]}");
const rawProps = z.record(z.string(), z.unknown()).describe("Notion property JSON (advanced), merged over values");
const rawBlocks = z.array(z.record(z.string(), z.unknown())).max(100).describe("Notion block JSON (advanced)");

export const notion = defineConnector({
  id: "notion",
  name: "Notion",
  icon: "N",
  description: "Search, read and write the Notion pages and databases you share with TARGET: create pages, add content, update properties, query databases, add rows and comments.",
  auth: "oauth",
  scopes: [],
  capabilities: [
    "Search pages and databases you shared; read a page's full content",
    "Create pages, append content, update page properties",
    "Query a database and add rows",
    "Read and add comments",
    "Move a page to trash (asks you first)",
  ],
  permissions: [
    "Notion asks you which pages to share with TARGET. It can only see and edit those pages (and their children).",
    "Capabilities (read content, update content, insert content, read/insert comments) are set on the Notion connection by the server owner.",
    "Moving a page to trash always waits for your approval. Remove access any time in Notion → Settings → Connections.",
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
  docs: [
    "https://developers.notion.com/docs/authorization", "https://developers.notion.com/reference/post-search",
    "https://developers.notion.com/reference/get-block-children", "https://developers.notion.com/reference/patch-block-children",
    "https://developers.notion.com/reference/post-page", "https://developers.notion.com/reference/patch-page",
    "https://developers.notion.com/reference/post-database-query", "https://developers.notion.com/reference/create-a-comment",
    "https://developers.notion.com/reference/retrieve-a-comment", "https://developers.notion.com/reference/revoke-token",
  ],
  todo: ["Owner: create the Notion public connection and set NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_CLIENT_SECRET.", "Move to Notion-Version 2025-09-03 (data sources) when needed."],
  getTools: () => [
    tool({
      name: "search",
      description: "Search Notion pages and/or databases shared with TARGET by title.",
      input: z.object({ query: z.string().max(200).default(""), type: z.enum(["page", "database", "any"]).default("any"), limit: z.number().int().min(1).max(100).default(20) }),
      async execute(a, ctx) {
        const j = await call<{ results?: Json[] }>(ctx, "/search", { method: "POST", body: { query: a.query, page_size: a.limit, ...(a.type !== "any" ? { filter: { property: "object", value: a.type } } : {}), sort: { direction: "descending", timestamp: "last_edited_time" } } });
        return (j.results ?? []).map((p) => ({ id: p.id, type: p.object, title: titleOf(p), url: p.url, last_edited_time: p.last_edited_time }));
      },
    }),
    tool({
      name: "read_page",
      description: "Read a Notion page: title, properties and full text content (headings, lists, to-dos, code; child pages/databases listed by id).",
      input: z.object({ page_id: pageId }),
      async execute(a, ctx) {
        const page = await call<Json>(ctx, `/pages/${a.page_id}`);
        const lines: string[] = [];
        let cursor: string | undefined;
        for (let n = 0; n < 5; n++) {
          const j = await call<{ results?: Json[]; has_more?: boolean; next_cursor?: string | null }>(ctx, `/blocks/${a.page_id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
          for (const b of j.results ?? []) { const l = blockLine(b); if (l) lines.push(l); }
          if (!j.has_more || !j.next_cursor) break;
          cursor = j.next_cursor;
        }
        return { id: page.id, title: titleOf(page), url: page.url, properties: props(page), content: clip(lines.join("\n"), 20000) };
      },
    }),
    tool({
      name: "create_page",
      description: "Create a page under a parent page shared with TARGET. Content is Markdown-ish text (# headings, - bullets, [ ] to-dos, ``` code).",
      input: z.object({ parent_page_id: pageId, title: z.string().min(1).max(200), content: z.string().max(50000).default(""), icon_emoji: z.string().max(8).optional() }),
      async execute(a, ctx) {
        const blocks = textToBlocks(a.content);
        const p = await call<Json>(ctx, "/pages", { method: "POST", body: { parent: { page_id: a.parent_page_id }, ...(a.icon_emoji ? { icon: { type: "emoji", emoji: a.icon_emoji } } : {}), properties: { title: { title: rich(a.title) } }, children: blocks.slice(0, 100) } });
        // Notion takes at most 100 children per request; append the rest.
        for (let i = 100; i < blocks.length; i += 100) await call(ctx, `/blocks/${String(p.id).replace(/-/g, "")}/children`, { method: "PATCH", body: { children: blocks.slice(i, i + 100) } });
        return { id: p.id, url: p.url, blocks: blocks.length };
      },
    }),
    tool({
      name: "append_blocks",
      description: "Append content to the end of a page (or under a block). Give Markdown-ish text, or raw Notion blocks.",
      input: z.object({ block_id: blockId, content: z.string().max(50000).optional(), blocks: rawBlocks.optional() }).refine((a) => !!a.content || !!a.blocks?.length, "Give content or blocks"),
      async execute(a, ctx) {
        const blocks = [...(a.content ? textToBlocks(a.content) : []), ...(a.blocks ?? [])];
        let added = 0;
        for (let i = 0; i < blocks.length; i += 100) {
          const j = await call<{ results?: Json[] }>(ctx, `/blocks/${a.block_id}/children`, { method: "PATCH", body: { children: blocks.slice(i, i + 100) } });
          added += j.results?.length ?? Math.min(100, blocks.length - i);
        }
        return { appended: added };
      },
    }),
    tool({
      name: "update_page_properties",
      description: "Update a page's title and/or properties (for database rows use simple values like {\"Status\":\"Done\"}).",
      input: z.object({ page_id: pageId, title: z.string().min(1).max(200).optional(), values: values.optional(), properties: rawProps.optional(), icon_emoji: z.string().max(8).optional() })
        .refine((a) => a.title || a.values || a.properties || a.icon_emoji, "Nothing to update"),
      async execute(a, ctx) {
        const page = await call<Json & { parent?: { type?: string; database_id?: string }; properties?: Schema }>(ctx, `/pages/${a.page_id}`);
        let schema: Schema = page.properties ?? {};
        if (page.parent?.type === "database_id" && page.parent.database_id) schema = (await call<{ properties?: Schema }>(ctx, `/databases/${page.parent.database_id.replace(/-/g, "")}`)).properties ?? schema;
        const out: Json = { ...(a.values ? toNotionProps(schema, a.values) : {}), ...(a.properties ?? {}) };
        if (a.title) {
          const titleKey = Object.entries(schema).find(([, v]) => v.type === "title")?.[0] ?? "title";
          out[titleKey] = { title: rich(a.title) };
        }
        const p = await call<Json>(ctx, `/pages/${a.page_id}`, { method: "PATCH", body: { properties: out, ...(a.icon_emoji ? { icon: { type: "emoji", emoji: a.icon_emoji } } : {}) } });
        return { updated: true, ...rowOut(p) };
      },
    }),
    tool({
      name: "query_database",
      description: "Query a Notion database: rows with simplified property values. Optional Notion filter / sorts JSON, or a plain-text title search.",
      input: z.object({
        database_id: databaseId, filter: z.record(z.string(), z.unknown()).optional().describe("Notion filter object, e.g. {\"property\":\"Status\",\"status\":{\"equals\":\"Done\"}}"),
        sorts: z.array(z.record(z.string(), z.unknown())).max(10).optional(), limit: z.number().int().min(1).max(500).default(50),
      }),
      async execute(a, ctx) {
        const db = await call<Json & { properties?: Schema }>(ctx, `/databases/${a.database_id}`);
        const rows: Json[] = [];
        let cursor: string | undefined;
        while (rows.length < a.limit) {
          const j = await call<{ results?: Json[]; has_more?: boolean; next_cursor?: string | null }>(ctx, `/databases/${a.database_id}/query`, { method: "POST", body: { page_size: Math.min(100, a.limit - rows.length), ...(a.filter ? { filter: a.filter } : {}), ...(a.sorts ? { sorts: a.sorts } : {}), ...(cursor ? { start_cursor: cursor } : {}) } });
          rows.push(...(j.results ?? []).map(rowOut));
          if (!j.has_more || !j.next_cursor) break;
          cursor = j.next_cursor;
        }
        return { database: titleOf(db), columns: Object.fromEntries(Object.entries(db.properties ?? {}).map(([k, v]) => [k, v.type])), rows };
      },
    }),
    tool({
      name: "create_database_row",
      description: "Add a row (page) to a Notion database using simple values by column name, e.g. {\"Name\":\"Buy milk\",\"Status\":\"To do\",\"Due\":\"2026-11-05\"}. Optional page content.",
      input: z.object({ database_id: databaseId, values, properties: rawProps.optional(), content: z.string().max(50000).optional() }),
      async execute(a, ctx) {
        const db = await call<{ properties?: Schema }>(ctx, `/databases/${a.database_id}`);
        const properties = { ...toNotionProps(db.properties ?? {}, a.values), ...(a.properties ?? {}) };
        const blocks = a.content ? textToBlocks(a.content).slice(0, 100) : [];
        const p = await call<Json>(ctx, "/pages", { method: "POST", body: { parent: { database_id: a.database_id }, properties, ...(blocks.length ? { children: blocks } : {}) } });
        return { created: true, ...rowOut(p) };
      },
    }),
    tool({
      name: "archive_page",
      description: "Move a Notion page (or database row) to trash. It can be restored from Notion's trash for 30 days. Always requires the user's approval.",
      input: z.object({ page_id: pageId }),
      requiresApproval: true,
      summarize: (a) => `Move Notion page ${a.page_id} to trash`,
      async prepare(a, ctx) {
        const p = await call<Json>(ctx, `/pages/${a.page_id}`);
        if (p.archived || p.in_trash) throw new ConnectorError("That page is already in trash.", 400, "invalid");
        const title = titleOf(p) || "Untitled";
        return { summary: `Move Notion page "${title}" to trash`, details: { Page: title, URL: String(p.url ?? ""), "Last edited": String(p.last_edited_time ?? "unknown") }, warning: "The page and everything inside it moves to Notion's trash (restorable from there for 30 days)." };
      },
      async execute(a, ctx) {
        const p = await call<Json>(ctx, `/pages/${a.page_id}`, { method: "PATCH", body: { archived: true } });
        return { archived: true, id: p.id, title: titleOf(p) };
      },
    }),
    tool({
      name: "list_comments",
      description: "List the comments on a page or block.",
      input: z.object({ block_id: blockId }),
      async execute(a, ctx) {
        const j = await call<{ results?: (Json & { rich_text?: RichText; created_by?: { id?: string } })[] }>(ctx, `/comments?block_id=${a.block_id}&page_size=100`);
        return (j.results ?? []).map((c) => ({ id: c.id, discussion_id: c.discussion_id, text: plain(c.rich_text), created_time: c.created_time, created_by: c.created_by?.id }));
      },
    }),
    tool({
      name: "add_comment",
      description: "Add a comment to a page, or reply in an existing discussion (give discussion_id).",
      input: z.object({ page_id: pageId.optional(), discussion_id: z.string().regex(/^[0-9a-f-]{32,36}$/i).optional(), text: z.string().min(1).max(2000) })
        .refine((a) => !!a.page_id !== !!a.discussion_id, "Give page_id or discussion_id"),
      async execute(a, ctx) {
        const c = await call<Json>(ctx, "/comments", { method: "POST", body: { ...(a.page_id ? { parent: { page_id: a.page_id } } : { discussion_id: a.discussion_id }), rich_text: rich(a.text) } });
        return { commented: true, id: c.id, discussion_id: c.discussion_id };
      },
    }),
  ],
});
