/**
 * Slack, Notion, Figma and Canva connectors: complete tool sets (hidden in the UI until their OAuth apps exist).
 * Provider HTTP is mocked; outward actions (post, DM, upload, schedule, trash, comment on Figma) must become approval
 * cards and never reach the provider from the chat path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));

import { encryptSecret, parseKey } from "@/lib/connectors/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { SHOWN_CONNECTORS } from "@/lib/connectors/shown";
import { executeToolCall, loadToolsForUser, toOpenAITools, toolsPrompt } from "@/lib/connectors/loadTools";
import { authorizeUrl, exchangeCode, refreshCreds } from "@/lib/connectors/oauth";
import { textToBlocks, toNotionProps } from "@/lib/connectors/notion";
import { resetMemoryLimits } from "@/lib/connectors/rateLimit";
import { decideApproval } from "@/lib/server/approvals";
import type { Db } from "@/lib/server/auth";
import type { ToolContext, ToolDef } from "@/lib/connectors/types";

const A = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = {
  CONNECTOR_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-test", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  SLACK_OAUTH_CLIENT_ID: "s-id", SLACK_OAUTH_CLIENT_SECRET: "s-secret", NOTION_OAUTH_CLIENT_ID: "n-id", NOTION_OAUTH_CLIENT_SECRET: "n-secret",
  CANVA_OAUTH_CLIENT_ID: "c-id", CANVA_OAUTH_CLIENT_SECRET: "c-secret", FIGMA_OAUTH_CLIENT_ID: "f-id", FIGMA_OAUTH_CLIENT_SECRET: "f-secret",
};
const saved: Record<string, string | undefined> = {};
const TOKENS: Record<string, string> = { slack: "xoxp-" + "1".repeat(30), notion: "ntn_" + "n".repeat(40), figma: "figd_" + "f".repeat(30), canva: "canva-" + "c".repeat(30) };
const conn = (id: string, meta?: Record<string, unknown>) => ({
  id: `${id}-conn`, user_id: A, connector_id: id, status: "connected", scopes: getConnector(id)!.scopes, account_label: `${id} acct`,
  encrypted_credentials: encryptSecret(JSON.stringify({ type: "oauth", access_token: TOKENS[id], ...(meta ? { meta } : {}) }), parseKey(KEY)), created_at: "2026-11-04T04:00:00Z", last_used_at: null,
});
const ctxOf = (f: typeof fetch) => ({ db: h.db as unknown as Db, userId: A, projectId: null, conversationId: null, taskId: null, f });

type Call = { method: string; url: URL; body?: unknown; headers: Record<string, string> };
/** Fake provider: key "METHOD host/path" → JSON body (or a function of the call). Records every call. */
function provider(routes: Record<string, unknown | ((c: Call) => unknown)>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    let body: unknown = init.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* raw */ } }
    if (body instanceof URLSearchParams) body = Object.fromEntries(body);
    const c: Call = { method, url: u, body, headers: Object.fromEntries(new Headers(init.headers).entries()) };
    calls.push(c);
    const r = routes[`${method} ${u.host}${u.pathname}`];
    if (r === undefined) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const out = typeof r === "function" ? (r as (c: Call) => unknown)(c) : r;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
type ApRow = { id: string; summary: string; status: string; payload: { connector: string; tool: string; preview?: { details?: Record<string, string>; warning?: string } } };
const aps = () => h.db.tables.approval_requests as unknown as ApRow[];
const toolOf = (cid: string, name: string) => getConnector(cid)!.getTools({ connector_id: cid, status: "connected", scopes: [], account_label: "" }).find((t) => t.name === name)! as ToolDef;
const run = (cid: string, name: string, args: unknown, f: typeof fetch, meta: Record<string, unknown> = {}) => {
  const t = toolOf(cid, name);
  return t.execute(t.input.parse(args), { token: TOKENS[cid], fetch: f, meta } as ToolContext);
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  h.db = new FakeDb({ connections: [conn("slack"), conn("notion"), conn("figma", { auth: "pat" }), conn("canva")], tasks: [], approval_requests: [], activity_events: [] });
  h.db.as(A);
  resetMemoryLimits();
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const EXPECTED: Record<string, { tools: string[]; approval: string[] }> = {
  slack: { tools: ["list_channels", "read_history", "read_thread", "search_messages", "send_message", "send_dm", "add_reaction", "upload_file", "set_status", "list_users", "schedule_message"], approval: ["send_message", "send_dm", "upload_file", "schedule_message"] },
  notion: { tools: ["search", "read_page", "create_page", "append_blocks", "update_page_properties", "query_database", "create_database_row", "archive_page", "list_comments", "add_comment"], approval: ["archive_page"] },
  figma: { tools: ["list_projects", "list_files", "get_design_context", "get_screenshot", "list_comments", "post_comment", "list_components", "list_styles"], approval: ["post_comment"] },
  canva: { tools: ["list_designs", "create_design", "export_design", "upload_asset", "list_folders", "list_brand_templates", "get_brand_template_fields", "autofill_brand_template"], approval: [] },
};

describe("tool registry", () => {
  it("offers every tool to the model once connected, with hints in the prompt", async () => {
    const { tools, connected } = await loadToolsForUser(A, h.db as unknown as Db);
    const names = toOpenAITools(tools, connected).map((s) => s.function.name);
    for (const [cid, e] of Object.entries(EXPECTED)) for (const t of e.tools) expect(names, `${cid}__${t}`).toContain(`${cid}__${t}`);
    const p = toolsPrompt(tools, connected);
    for (const k of ["SLACK:", "NOTION:", "FIGMA:", "CANVA:"]) expect(p).toContain(k);
  });

  it("marks exactly the outward / destructive tools as needing approval", () => {
    for (const [cid, e] of Object.entries(EXPECTED)) {
      for (const t of getConnector(cid)!.getTools({ connector_id: cid, status: "connected", scopes: [], account_label: "" })) {
        const needs = typeof t.requiresApproval === "function" ? "sometimes" : !!t.requiresApproval;
        expect(needs, `${cid}.${t.name}`).toBe(e.approval.includes(t.name));
      }
    }
  });

  it("stays hidden in the UI", () => {
    expect([...SHOWN_CONNECTORS]).toEqual(["github", "google", "supabase", "vercel"]);
  });
});

describe("Slack", () => {
  it("send_message becomes an approval card naming the channel; nothing is posted until approve", async () => {
    const { f, calls } = provider({
      "GET slack.com/api/conversations.info": { ok: true, channel: { name: "general" } },
      "POST slack.com/api/chat.postMessage": { ok: true, channel: "C0123456789", ts: "1712345678.000100" },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "slack__send_message", JSON.stringify({ channel: "C0123456789", text: "Ship it" }));
    expect(r.kind).toBe("approval");
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/conversations.info"]);
    const ap = aps()[0];
    expect(ap.summary).toBe("Send a Slack message to #general (C0123456789)");
    expect(ap.payload.preview?.details).toMatchObject({ Channel: "#general (C0123456789)", Message: "Ship it" });

    await decideApproval(h.db as unknown as Db, A, ap.id, "approve");
    const posts = calls.filter((c) => c.url.pathname === "/api/chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ channel: "C0123456789", text: "Ship it" });
    expect(posts[0].headers.authorization).toBe(`Bearer ${TOKENS.slack}`);
  });

  it("DMs, uploads and scheduled messages also pause for approval", async () => {
    const { f, calls } = provider({
      "GET slack.com/api/users.info": { ok: true, user: { real_name: "Asha" } },
      "GET slack.com/api/conversations.info": { ok: true, channel: { name: "design" } },
    });
    const later = new Date(Date.now() + 3600_000).toISOString();
    for (const [t, args] of [
      ["send_dm", { user: "U0123456789", text: "hi" }],
      ["upload_file", { channel: "C0123456789", filename: "notes.md", content: "# Notes" }],
      ["schedule_message", { channel: "C0123456789", text: "standup", post_at: later }],
    ] as const) expect((await executeToolCall(ctxOf(f), `slack__${t}`, JSON.stringify(args))).kind, t).toBe("approval");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(aps().find((a) => a.payload.tool === "send_dm")!.summary).toBe("Send a Slack DM to Asha (U0123456789)");
  });

  it("refuses to schedule in the past before asking", async () => {
    const { f } = provider({});
    const r = await executeToolCall(ctxOf(f), "slack__schedule_message", JSON.stringify({ channel: "C0123456789", text: "x", post_at: "2020-01-01T00:00:00Z" }));
    expect(r.kind).toBe("error");
    expect(aps()).toHaveLength(0);
  });

  it("reads history directly and maps Slack errors (missing_scope → reconnect)", async () => {
    const { f, calls } = provider({ "GET slack.com/api/conversations.history": { ok: true, messages: [{ ts: "1712345678.000100", user: "U1", text: "hello", reply_count: 2 }] } });
    const r = await executeToolCall(ctxOf(f), "slack__read_history", JSON.stringify({ channel: "C0123456789", limit: 5 }));
    expect(r.kind).toBe("result");
    expect(r.content).toContain("hello");
    expect(calls[0].url.searchParams.get("channel")).toBe("C0123456789");
    expect(calls[0].url.searchParams.get("limit")).toBe("5");

    const { f: f2 } = provider({ "GET slack.com/api/search.messages": { ok: false, error: "missing_scope", needed: "search:read" } });
    const s = await executeToolCall(ctxOf(f2), "slack__search_messages", JSON.stringify({ query: "launch" }));
    expect(s.kind).toBe("needs_connection");
    expect(JSON.parse(s.content)).toMatchObject({ error: "reconnect_required", missing_scope: "search:read" });
  });

  it("upload_file runs the three-step external upload", async () => {
    const { f, calls } = provider({
      "POST slack.com/api/files.getUploadURLExternal": { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F0001" },
      "POST files.slack.com/upload/v1/abc": { ok: true },
      "POST slack.com/api/files.completeUploadExternal": { ok: true, files: [{ id: "F0001" }] },
    });
    const out = await run("slack", "upload_file", { channel: "C0123456789", filename: "a.txt", content: "hello", thread_ts: "1712345678.000100" }, f);
    expect(out).toMatchObject({ uploaded: true, file_id: "F0001" });
    expect(calls[0].body).toEqual({ filename: "a.txt", length: "5" });
    expect(calls[2].body).toMatchObject({ files: [{ id: "F0001", title: "a.txt" }], channel_id: "C0123456789", thread_ts: "1712345678.000100" });
  });

  it("set_status and reactions run without approval", async () => {
    const { f, calls } = provider({ "POST slack.com/api/users.profile.set": { ok: true }, "POST slack.com/api/reactions.add": { ok: true } });
    await run("slack", "set_status", { text: "Lunch", emoji: ":taco:", expires_in_minutes: 30 }, f);
    expect((calls[0].body as { profile: Record<string, unknown> }).profile).toMatchObject({ status_text: "Lunch", status_emoji: ":taco:" });
    await run("slack", "add_reaction", { channel: "C0123456789", timestamp: "1712345678.000100", name: ":thumbsup:" }, f);
    expect(calls[1].body).toEqual({ channel: "C0123456789", timestamp: "1712345678.000100", name: "thumbsup" });
  });

  it("OAuth asks for user scopes and keeps the user token from authed_user", async () => {
    const slack = getConnector("slack")!;
    const u = new URL(authorizeUrl(slack, ENV, { redirectUri: "https://t/cb", state: "s" }));
    expect(u.searchParams.get("user_scope")).toContain("search:read");
    expect(u.searchParams.get("scope")).toBeNull();
    const { f } = provider({
      "POST slack.com/api/oauth.v2.access": { ok: true, team: { name: "Acme" }, authed_user: { id: "U1", access_token: "xoxp-user-token-123456", scope: "search:read,chat:write" } },
      "GET slack.com/api/auth.test": { ok: true, user: "vikash", team: "Acme" },
    });
    const t = await exchangeCode(slack, ENV, { code: "c", redirectUri: "https://t/cb" }, f);
    expect(t.creds.access_token).toBe("xoxp-user-token-123456");
    expect(t.scopes).toEqual(["search:read", "chat:write"]);
    expect(t.accountLabel).toBe("vikash @ Acme");
  });
});

describe("Notion", () => {
  it("archive_page pauses with the page title on the card, then trashes it on approve", async () => {
    const PID = "0123456789abcdef0123456789abcdef";
    const { f, calls } = provider({
      [`GET api.notion.com/v1/pages/${PID}`]: { id: PID, url: "https://notion.so/x", properties: { Name: { type: "title", title: [{ plain_text: "Old plan" }] } } },
      [`PATCH api.notion.com/v1/pages/${PID}`]: { id: PID, archived: true, properties: { Name: { type: "title", title: [{ plain_text: "Old plan" }] } } },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "notion__archive_page", JSON.stringify({ page_id: `https://www.notion.so/Old-plan-${PID}` }));
    expect(r.kind).toBe("approval");
    expect(aps()[0].summary).toBe('Move Notion page "Old plan" to trash');
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ archived: true }]);
  });

  it("create_database_row maps simple values through the database schema", async () => {
    const DB = "fedcba9876543210fedcba9876543210";
    const { f, calls } = provider({
      [`GET api.notion.com/v1/databases/${DB}`]: { properties: { Name: { type: "title" }, Status: { type: "status" }, Due: { type: "date" }, Tags: { type: "multi_select" }, Points: { type: "number" }, Done: { type: "checkbox" } } },
      "POST api.notion.com/v1/pages": { id: "row1", url: "https://notion.so/row1", properties: {} },
    });
    await run("notion", "create_database_row", { database_id: DB, values: { Name: "Buy milk", Status: "To do", Due: "2026-11-05", Tags: "home, errands", Points: "3", Done: false }, content: "- whole milk" }, f);
    const body = calls[1].body as { parent: unknown; properties: Record<string, unknown>; children: unknown[] };
    expect(body.parent).toEqual({ database_id: DB });
    expect(body.properties).toEqual({
      Name: { title: [{ type: "text", text: { content: "Buy milk" } }] }, Status: { status: { name: "To do" } }, Due: { date: { start: "2026-11-05" } },
      Tags: { multi_select: [{ name: "home" }, { name: "errands" }] }, Points: { number: 3 }, Done: { checkbox: false },
    });
    expect(body.children).toHaveLength(1);
    expect(() => toNotionProps({ Name: { type: "title" } }, { Nope: "x" })).toThrow(/isn't a property/);
  });

  it("turns Markdown-ish text into Notion blocks", () => {
    const b = textToBlocks("# Title\n\nIntro line\n- one\n1. first\n[x] done\n> quote\n```ts\nconst a = 1;\n```\n---");
    expect(b.map((x) => x.type)).toEqual(["heading_1", "paragraph", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "code", "divider"]);
    expect((b[4].to_do as { checked: boolean }).checked).toBe(true);
    expect((b[6].code as { language: string }).language).toBe("ts");
  });

  it("query_database returns simplified rows", async () => {
    const DB = "fedcba9876543210fedcba9876543210";
    const { f, calls } = provider({
      [`GET api.notion.com/v1/databases/${DB}`]: { title: [{ plain_text: "Tasks" }], properties: { Name: { type: "title" }, Status: { type: "status" } } },
      [`POST api.notion.com/v1/databases/${DB}/query`]: { results: [{ id: "r1", properties: { Name: { type: "title", title: [{ plain_text: "A" }] }, Status: { type: "status", status: { name: "Done" } } } }], has_more: false },
    });
    const out = await run("notion", "query_database", { database_id: DB, filter: { property: "Status", status: { equals: "Done" } } }, f) as { database: string; rows: { properties: unknown }[] };
    expect(out.database).toBe("Tasks");
    expect(out.rows[0].properties).toEqual({ Name: "A", Status: "Done" });
    expect((calls[1].body as { filter: unknown }).filter).toEqual({ property: "Status", status: { equals: "Done" } });
    expect(calls[1].headers["notion-version"]).toBe("2022-06-28");
  });
});

describe("Figma", () => {
  it("post_comment pauses for approval naming the file; the PAT goes in X-Figma-Token", async () => {
    const { f, calls } = provider({
      "GET api.figma.com/v1/files/AbCdEf12345/meta": { file: { name: "Landing v2" } },
      "POST api.figma.com/v1/files/AbCdEf12345/comments": { id: "99", created_at: "2026-11-04T04:00:00Z" },
    });
    vi.stubGlobal("fetch", f);
    const r = await executeToolCall(ctxOf(f), "figma__post_comment", JSON.stringify({ file: "https://www.figma.com/design/AbCdEf12345/Landing", message: "Tighten spacing", node_id: "1-2" }));
    expect(r.kind).toBe("approval");
    expect(aps()[0].summary).toBe('Post a comment on Figma file "Landing v2"');
    expect(calls[0].headers["x-figma-token"]).toBe(TOKENS.figma);
    await decideApproval(h.db as unknown as Db, A, aps()[0].id, "approve");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ message: "Tighten spacing", client_meta: { node_id: "1:2", node_offset: { x: 0, y: 0 } } });
  });

  it("lists projects/files/components; OAuth connections use a Bearer token", async () => {
    const { f, calls } = provider({
      "GET api.figma.com/v1/teams/123/projects": { name: "Team", projects: [{ id: 5, name: "Web" }] },
      "GET api.figma.com/v1/projects/5/files": { files: [{ key: "K1abc", name: "Home" }] },
      "GET api.figma.com/v1/files/K1abc/components": { meta: { components: [{ key: "c1", name: "Button", node_id: "1:3" }] } },
      "GET api.figma.com/v1/files/K1abc/component_sets": { meta: { component_sets: [] } },
    });
    expect(await run("figma", "list_projects", { team_id: "123" }, f, { auth: "oauth" })).toEqual({ team: "Team", projects: [{ id: "5", name: "Web" }] });
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKENS.figma}`);
    const files = await run("figma", "list_files", { project_id: "5" }, f) as { files: { url: string }[] };
    expect(files.files[0].url).toBe("https://www.figma.com/design/K1abc");
    const comps = await run("figma", "list_components", { file: "K1abc" }, f) as { components: { name: string }[] };
    expect(comps.components[0].name).toBe("Button");
  });

  it("refreshes OAuth tokens at /v1/oauth/refresh", async () => {
    const { f, calls } = provider({ "POST api.figma.com/v1/oauth/refresh": { access_token: "figu_new_token_value", expires_in: 7776000 } });
    const c = await refreshCreds(getConnector("figma")!, ENV, { access_token: "old", refresh_token: "r1", meta: { auth: "oauth" } }, f);
    expect(calls[0].url.pathname).toBe("/v1/oauth/refresh");
    expect(c).toMatchObject({ access_token: "figu_new_token_value", refresh_token: "r1", meta: { auth: "oauth" } });
  });
});

describe("Canva", () => {
  it("export_design returns the URLs of a finished job", async () => {
    const { f, calls } = provider({ "POST api.canva.com/rest/v1/exports": { job: { id: "j1", status: "success", urls: ["https://export.canva.com/a.pdf"] } } });
    expect(await run("canva", "export_design", { design_id: "https://www.canva.com/design/DAFVztcvd9z/edit", format: "pdf" }, f)).toEqual({ status: "success", urls: ["https://export.canva.com/a.pdf"] });
    expect(calls[0].body).toEqual({ design_id: "DAFVztcvd9z", format: { type: "pdf" } });
  });

  it("upload_asset polls the URL upload job", async () => {
    let n = 0;
    const { f } = provider({
      "POST api.canva.com/rest/v1/url-asset-uploads": { job: { id: "u1", status: "in_progress" } },
      "GET api.canva.com/rest/v1/url-asset-uploads/u1": () => (++n < 2 ? { job: { id: "u1", status: "in_progress" } } : { job: { id: "u1", status: "success", asset: { id: "Msd59349ff", name: "logo", type: "image" } } }),
    });
    vi.useFakeTimers();
    const p = run("canva", "upload_asset", { name: "logo", url: "https://example.com/logo.png" }, f);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await p).toEqual({ status: "success", asset_id: "Msd59349ff", name: "logo", type: "image" });
  });

  it("autofill maps fields by the template's dataset and refuses unknown ones", async () => {
    const { f, calls } = provider({
      "GET api.canva.com/rest/v1/brand-templates/BT123/dataset": { dataset: { headline: { type: "text" }, hero: { type: "image" } } },
      "POST api.canva.com/rest/v1/autofills": { job: { id: "a1", status: "success", result: { type: "create_design", design: { id: "D1", title: "Promo", urls: { edit_url: "https://canva.com/e" } } } } },
    });
    const out = await run("canva", "autofill_brand_template", { brand_template_id: "BT123", title: "Promo", fields: { headline: "50% off", hero: { asset_id: "Msd59349ff" } } }, f);
    expect(out).toMatchObject({ status: "success", design: { id: "D1", edit_url: "https://canva.com/e" } });
    expect(calls[1].body).toEqual({ type: "create_from_brand_template", brand_template_id: "BT123", title: "Promo", data: { headline: { type: "text", text: "50% off" }, hero: { type: "image", asset_id: "Msd59349ff" } } });
    await expect(run("canva", "autofill_brand_template", { brand_template_id: "BT123", fields: { nope: "x" } }, f)).rejects.toThrow(/isn't a field/);
  });

  it("lists folder items and designs", async () => {
    const { f, calls } = provider({
      "GET api.canva.com/rest/v1/folders/root/items": { items: [{ type: "folder", folder: { id: "F1", name: "Brand" } }, { type: "design", design: { id: "D2", title: "Deck" } }] },
      "GET api.canva.com/rest/v1/designs": { items: [{ id: "D2", title: "Deck", updated_at: 1700000000 }] },
    });
    const folders = await run("canva", "list_folders", {}, f) as { items: { type: string; id: string }[] };
    expect(folders.items.map((i) => [i.type, i.id])).toEqual([["folder", "F1"], ["design", "D2"]]);
    const designs = await run("canva", "list_designs", { query: "deck" }, f) as { id: string; updated_at: string }[];
    expect(designs[0]).toMatchObject({ id: "D2", updated_at: "2023-11-14T22:13:20.000Z" });
    expect(calls[1].url.searchParams.get("query")).toBe("deck");
  });
});
