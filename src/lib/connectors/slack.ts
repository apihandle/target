import { z } from "zod";
import { clip, defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError, MissingScopeError } from "@/lib/connectors/http";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";

/**
 * Slack, via the Web API (https://docs.slack.dev/reference/methods) with a USER token from OAuth v2.
 *
 * Why a user token: search.messages and users.profile.set (status) only work with user tokens, and people expect
 * "send a message" to come from them, not from a bot that first has to be invited to every channel. The OAuth flow
 * asks for `user_scope` only, and the token comes back under `authed_user` (https://docs.slack.dev/authentication/installing-with-oauth).
 * Everything that posts (messages, replies, DMs, uploads, scheduled messages) waits for the user's approval.
 */
const CONNECTOR = "slack", NAME = "Slack";
const API = "https://slack.com/api";

type Json = Record<string, unknown>;
type Opts = { query?: Record<string, string | number | boolean | undefined>; json?: Json; form?: Record<string, string> };

/** One Web API call. Reads go as GET with a query string; writes as JSON (or form where the method requires it). */
async function slack<T = Json>(ctx: ToolContext, method: string, o: Opts = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== "") q.set(k, String(v));
  const url = `${API}/${method}${q.toString() ? `?${q}` : ""}`;
  const post = !!(o.json || o.form);
  const j = await apiFetch<Json>(url, {
    method: post ? "POST" : "GET", f: ctx.fetch,
    body: o.json ? JSON.stringify(o.json) : o.form ? new URLSearchParams(o.form) : undefined,
    headers: { Authorization: `Bearer ${ctx.token}`, ...(o.json ? { "Content-Type": "application/json; charset=utf-8" } : {}) },
  });
  if (j.ok === false) {
    const e = String(j.error ?? "request_failed");
    if (e === "missing_scope") throw new MissingScopeError(CONNECTOR, NAME, String(j.needed ?? "a newer permission"));
    if (e === "invalid_auth" || e === "token_revoked" || e === "token_expired" || e === "not_authed" || e === "account_inactive") throw new ConnectorError(`Slack: ${e}`, 401, "auth");
    if (e === "ratelimited") throw new ConnectorError("Slack is rate limiting requests; try again in a minute.", 429, "rate_limited");
    const nf = /_not_found$|^not_in_channel$/.test(e);
    throw new ConnectorError(`Slack: ${e}`, nf ? 404 : 400, nf ? "not_found" : "invalid");
  }
  return j as T;
}

const id = (what: string) => z.string().regex(/^[A-Z0-9]{8,15}$/, `${what} id, e.g. C0123456789`);
const channel = id("Channel (or DM) ").describe("Channel / DM / group id (C…, G…, D…). Use list_channels to find it.");
const userId = id("User ").describe("Slack user id (U… or W…). Use list_users to find it.");
const ts = z.string().regex(/^\d{9,11}\.\d{1,8}$/, "A Slack message timestamp, e.g. 1712345678.123456");
const text = z.string().min(1).max(4000);

type Msg = { ts?: string; user?: string; text?: string; thread_ts?: string; reply_count?: number; bot_id?: string; files?: { name?: string }[] };
const msgOut = (m: Msg) => ({
  ts: m.ts, user: m.user ?? m.bot_id, text: clip(String(m.text ?? ""), 2000),
  ...(m.thread_ts && m.thread_ts !== m.ts ? { thread_ts: m.thread_ts } : {}),
  ...(m.reply_count ? { reply_count: m.reply_count } : {}),
  ...(m.files?.length ? { files: m.files.map((f) => f.name) } : {}),
});

/** What the approval card shows for a post: the channel's real name (looked up read-only) and the text. */
async function channelLabel(ctx: ToolContext, ch: string): Promise<string> {
  try {
    const j = await slack<{ channel?: { name?: string; is_im?: boolean; user?: string; is_private?: boolean } }>(ctx, "conversations.info", { query: { channel: ch } });
    const c = j.channel ?? {};
    if (c.is_im) return `Direct message${c.user ? ` with ${await userLabel(ctx, c.user)}` : ""} (${ch})`;
    return c.name ? `#${c.name}${c.is_private ? " (private)" : ""} (${ch})` : ch;
  } catch (e) {
    if (e instanceof MissingScopeError || (e instanceof ConnectorError && e.code === "auth")) throw e;
    return ch;
  }
}
async function userLabel(ctx: ToolContext, u: string): Promise<string> {
  try {
    const j = await slack<{ user?: { name?: string; real_name?: string; profile?: { display_name?: string } } }>(ctx, "users.info", { query: { user: u } });
    const x = j.user ?? {};
    const n = x.profile?.display_name || x.real_name || x.name;
    return n ? `${n} (${u})` : u;
  } catch { return u; }
}
const preview = (summary: string, details: Record<string, string>, warning?: string): ToolPreview => ({ summary, details, ...(warning ? { warning } : {}) });

const fileInput = z.object({
  channel, filename: z.string().min(1).max(200).regex(/^[^/\\]+$/, "A file name, not a path"),
  content: z.string().max(1_000_000).optional().describe("Text content of the file (code, CSV, Markdown, notes…)"),
  content_base64: z.string().max(1_400_000).optional().describe("Binary file content, base64-encoded (max ~1 MB)"),
  title: z.string().max(200).optional(), initial_comment: z.string().max(4000).optional(), thread_ts: ts.optional(),
}).refine((a) => !!a.content !== !!a.content_base64, "Give exactly one of content or content_base64");

export const slackConnector = defineConnector({
  id: CONNECTOR,
  name: NAME,
  icon: "#",
  description: "Read and search your Slack, post and reply as you, DM people, react, upload files, schedule messages and set your status. Everything that posts asks you first.",
  auth: "oauth",
  scopes: [
    "channels:read", "groups:read", "im:read", "mpim:read",
    "channels:history", "groups:history", "im:history", "mpim:history",
    "search:read", "chat:write", "im:write", "reactions:write", "files:write",
    "users:read", "users.profile:write",
  ],
  capabilities: [
    "List channels and DMs; read channel history and threads",
    "Search messages across the workspace",
    "Post or reply in a channel, DM a person, upload a file, schedule a message (each asks you first)",
    "Add emoji reactions, set your status, list people in the workspace",
  ],
  permissions: [
    "Acts as you (a Slack user token), so it sees the channels and DMs you can see and posts under your name.",
    "channels/groups/im/mpim:read + :history: list conversations and read their messages. search:read: search messages.",
    "chat:write, im:write, files:write: post, DM and upload. Each of these waits for your approval on an approval card.",
    "reactions:write: add reactions. users:read: list people. users.profile:write: set your status.",
    "Remove access any time in Slack → Settings & administration → Manage apps.",
  ],
  requiredEnv: ["SLACK_OAUTH_CLIENT_ID", "SLACK_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: `${API}/oauth.v2.access`,
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    scopeParam: "user_scope",
    scopeSeparator: ",",
    refreshable: true,
    parseToken(j) {
      // Install with user scopes only: the token is under authed_user. A refresh answers with it at the top level.
      const u = j.authed_user as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number } | undefined;
      if (!u?.access_token) return {};
      return {
        access_token: u.access_token, refresh_token: u.refresh_token, scope: u.scope,
        ...(typeof u.expires_in === "number" && u.expires_in > 0 ? { expires_at: Date.now() + u.expires_in * 1000 } : {}),
      };
    },
    async accountLabel(token, j, f) {
      const team = (j.team as { name?: string } | undefined)?.name;
      try {
        const me = await apiFetch<{ ok?: boolean; user?: string; team?: string }>(`${API}/auth.test`, { f, headers: { Authorization: `Bearer ${token}` } });
        if (me.ok && me.user) return `${me.user} @ ${me.team ?? team ?? "Slack"}`;
      } catch { /* label is cosmetic */ }
      return team ? `Workspace: ${team}` : "";
    },
    async revoke(creds, _env, f) {
      await f(`${API}/auth.revoke`, { method: "POST", headers: { Authorization: `Bearer ${creds.access_token}` } }).catch(() => undefined);
    },
  },
  docs: [
    "https://docs.slack.dev/authentication/installing-with-oauth", "https://docs.slack.dev/reference/methods/conversations.history",
    "https://docs.slack.dev/reference/methods/search.messages", "https://docs.slack.dev/reference/methods/chat.postMessage",
    "https://docs.slack.dev/reference/methods/chat.scheduleMessage", "https://docs.slack.dev/reference/methods/files.getUploadURLExternal",
    "https://docs.slack.dev/reference/methods/files.completeUploadExternal", "https://docs.slack.dev/reference/methods/users.profile.set",
  ],
  todo: ["Owner: create the Slack app (user token scopes listed above) and set SLACK_OAUTH_CLIENT_ID / SLACK_OAUTH_CLIENT_SECRET."],
  getTools: () => [
    tool({
      name: "list_channels",
      description: "List Slack conversations you can see: public and private channels, DMs and group DMs (id, name, type, member count).",
      input: z.object({ types: z.array(z.enum(["public_channel", "private_channel", "im", "mpim"])).min(1).default(["public_channel", "private_channel"]), query: z.string().max(80).optional().describe("Only names containing this"), limit: z.number().int().min(1).max(1000).default(200) }),
      async execute(a, ctx) {
        const out: Json[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5 && out.length < a.limit; page++) {
          const j = await slack<{ channels?: Json[]; response_metadata?: { next_cursor?: string } }>(ctx, "conversations.list", { query: { types: a.types.join(","), exclude_archived: true, limit: 200, cursor } });
          for (const c of j.channels ?? []) out.push({ id: c.id, name: c.name ?? (c.is_im ? `DM ${c.user}` : undefined), is_member: c.is_im ? true : c.is_member, type: c.is_im ? "im" : c.is_mpim ? "mpim" : c.is_private ? "private_channel" : "public_channel", members: c.num_members, topic: (c.topic as { value?: string } | undefined)?.value || undefined });
          cursor = j.response_metadata?.next_cursor || undefined;
          if (!cursor) break;
        }
        const q = a.query?.toLowerCase();
        return out.filter((c) => !q || String(c.name ?? "").toLowerCase().includes(q)).slice(0, a.limit);
      },
    }),
    tool({
      name: "read_history",
      description: "Read recent messages in a channel or DM (newest first). Optional time window as Slack timestamps.",
      input: z.object({ channel, limit: z.number().int().min(1).max(200).default(30), oldest: ts.optional(), latest: ts.optional() }),
      async execute(a, ctx) {
        const j = await slack<{ messages?: Msg[]; has_more?: boolean }>(ctx, "conversations.history", { query: { channel: a.channel, limit: a.limit, oldest: a.oldest, latest: a.latest } });
        return { messages: (j.messages ?? []).map(msgOut), has_more: !!j.has_more };
      },
    }),
    tool({
      name: "read_thread",
      description: "Read a thread: the parent message and its replies.",
      input: z.object({ channel, thread_ts: ts, limit: z.number().int().min(1).max(200).default(100) }),
      async execute(a, ctx) {
        const j = await slack<{ messages?: Msg[]; has_more?: boolean }>(ctx, "conversations.replies", { query: { channel: a.channel, ts: a.thread_ts, limit: a.limit } });
        return { messages: (j.messages ?? []).map(msgOut), has_more: !!j.has_more };
      },
    }),
    tool({
      name: "search_messages",
      description: "Search messages across the workspace. Supports Slack search syntax (in:#channel, from:@user, before:2026-01-01, has:link…).",
      input: z.object({ query: z.string().min(1).max(500), count: z.number().int().min(1).max(100).default(20), sort: z.enum(["score", "timestamp"]).default("score") }),
      async execute(a, ctx) {
        const j = await slack<{ messages?: { total?: number; matches?: (Msg & { channel?: { id?: string; name?: string }; username?: string; permalink?: string })[] } }>(ctx, "search.messages", { query: { query: a.query, count: a.count, sort: a.sort } });
        return { total: j.messages?.total ?? 0, matches: (j.messages?.matches ?? []).map((m) => ({ ...msgOut(m), channel: m.channel?.id, channel_name: m.channel?.name, username: m.username, permalink: m.permalink })) };
      },
    }),
    tool({
      name: "send_message",
      description: "Post a message as you in a channel, or reply in a thread (give thread_ts). Always requires the user's approval.",
      input: z.object({ channel, text, thread_ts: ts.optional().describe("Reply in this thread"), also_send_to_channel: z.boolean().default(false).describe("For thread replies: also show it in the channel") }),
      requiresApproval: true,
      summarize: (a) => a.thread_ts ? `Reply in a Slack thread in ${a.channel}` : `Send a Slack message to ${a.channel}`,
      async prepare(a, ctx) {
        const where = await channelLabel(ctx, a.channel);
        return preview(a.thread_ts ? `Reply in a Slack thread in ${where}` : `Send a Slack message to ${where}`, { Channel: where, ...(a.thread_ts ? { Thread: a.thread_ts } : {}), Message: a.text }, "This posts under your name and people in the conversation will see it.");
      },
      async execute(a, ctx) {
        const j = await slack<{ ts?: string; channel?: string }>(ctx, "chat.postMessage", { json: { channel: a.channel, text: a.text, ...(a.thread_ts ? { thread_ts: a.thread_ts, reply_broadcast: a.also_send_to_channel } : {}) } });
        return { sent: true, channel: j.channel, ts: j.ts };
      },
    }),
    tool({
      name: "send_dm",
      description: "Send a direct message as you to a person (opens the DM if needed). Always requires the user's approval.",
      input: z.object({ user: userId, text }),
      requiresApproval: true,
      summarize: (a) => `Send a Slack DM to ${a.user}`,
      async prepare(a, ctx) {
        const who = await userLabel(ctx, a.user);
        return preview(`Send a Slack DM to ${who}`, { To: who, Message: a.text }, "This sends a direct message under your name.");
      },
      async execute(a, ctx) {
        const open = await slack<{ channel?: { id?: string } }>(ctx, "conversations.open", { json: { users: a.user } });
        const ch = open.channel?.id;
        if (!ch) throw new ConnectorError("Slack didn't open a DM with that person.", 502);
        const j = await slack<{ ts?: string }>(ctx, "chat.postMessage", { json: { channel: ch, text: a.text } });
        return { sent: true, channel: ch, ts: j.ts };
      },
    }),
    tool({
      name: "add_reaction",
      description: "Add an emoji reaction (e.g. thumbsup, white_check_mark, eyes) to a message.",
      input: z.object({ channel, timestamp: ts, name: z.string().min(1).max(100).transform((s) => s.replace(/^:|:$/g, "")).pipe(z.string().regex(/^[a-z0-9_+'-]+(::skin-tone-[2-6])?$/, "An emoji name like thumbsup")) }),
      async execute(a, ctx) {
        await slack(ctx, "reactions.add", { json: { channel: a.channel, timestamp: a.timestamp, name: a.name } });
        return { reacted: true, name: a.name };
      },
    }),
    tool({
      name: "upload_file",
      description: "Upload a file (text or base64 content) and share it in a channel/DM, optionally in a thread. Always requires the user's approval.",
      input: fileInput,
      requiresApproval: true,
      summarize: (a) => `Upload ${a.filename} to Slack ${a.channel}`,
      async prepare(a, ctx) {
        const where = await channelLabel(ctx, a.channel);
        const bytes = a.content !== undefined ? Buffer.byteLength(a.content, "utf8") : Buffer.from(a.content_base64 ?? "", "base64").length;
        return preview(`Upload ${a.filename} to ${where}`, { Channel: where, File: a.filename, Size: `${Math.max(1, Math.round(bytes / 1024))} KB`, ...(a.initial_comment ? { Comment: a.initial_comment } : {}) }, "The file is shared under your name with everyone in the conversation.");
      },
      async execute(a, ctx) {
        const data = a.content !== undefined ? Buffer.from(a.content, "utf8") : Buffer.from(a.content_base64 ?? "", "base64");
        if (!data.length) throw new ConnectorError("The file is empty.", 400, "invalid");
        // 1) ask for an upload URL (this method takes form fields, not JSON), 2) POST the bytes there, 3) complete + share.
        const up = await slack<{ upload_url?: string; file_id?: string }>(ctx, "files.getUploadURLExternal", { form: { filename: a.filename, length: String(data.length) } });
        if (!up.upload_url || !up.file_id || !/^https:\/\/files\.slack\.com\//.test(up.upload_url)) throw new ConnectorError("Slack didn't return an upload URL.", 502);
        const r = await ctx.fetch(up.upload_url, { method: "POST", body: new Uint8Array(data), headers: { "Content-Type": "application/octet-stream" } });
        if (!r.ok) throw new ConnectorError(`Slack upload failed (${r.status})`, 502);
        const done = await slack<{ files?: { id?: string; title?: string }[] }>(ctx, "files.completeUploadExternal", { json: {
          files: [{ id: up.file_id, title: a.title ?? a.filename }], channel_id: a.channel,
          ...(a.initial_comment ? { initial_comment: a.initial_comment } : {}), ...(a.thread_ts ? { thread_ts: a.thread_ts } : {}),
        } });
        return { uploaded: true, file_id: done.files?.[0]?.id ?? up.file_id, channel: a.channel };
      },
    }),
    tool({
      name: "set_status",
      description: "Set (or clear, with empty text) your Slack status, with an optional emoji and expiry in minutes.",
      input: z.object({ text: z.string().max(100).default(""), emoji: z.string().max(100).regex(/^(:[a-z0-9_+'-]+:)?$/, "Like :palm_tree:").default(""), expires_in_minutes: z.number().int().min(0).max(60 * 24 * 30).default(0) }),
      async execute(a, ctx) {
        const exp = a.expires_in_minutes ? Math.floor(Date.now() / 1000) + a.expires_in_minutes * 60 : 0;
        await slack(ctx, "users.profile.set", { json: { profile: { status_text: a.text, status_emoji: a.emoji, status_expiration: exp } } });
        return { status: a.text || "(cleared)", emoji: a.emoji, expires_at: exp ? new Date(exp * 1000).toISOString() : null };
      },
    }),
    tool({
      name: "list_users",
      description: "List people in the workspace (id, handle, real name, title, whether a bot). Optional name filter.",
      input: z.object({ query: z.string().max(80).optional(), limit: z.number().int().min(1).max(1000).default(200) }),
      async execute(a, ctx) {
        const out: Json[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page++) {
          const j = await slack<{ members?: (Json & { profile?: { display_name?: string; title?: string } })[]; response_metadata?: { next_cursor?: string } }>(ctx, "users.list", { query: { limit: 200, cursor } });
          for (const m of j.members ?? []) if (!m.deleted) out.push({ id: m.id, name: m.name, real_name: m.real_name, display_name: m.profile?.display_name || undefined, title: m.profile?.title || undefined, is_bot: !!m.is_bot, tz: m.tz });
          cursor = j.response_metadata?.next_cursor || undefined;
          if (!cursor) break;
        }
        const q = a.query?.toLowerCase();
        return out.filter((u) => !q || [u.name, u.real_name, u.display_name].some((v) => String(v ?? "").toLowerCase().includes(q))).slice(0, a.limit);
      },
    }),
    tool({
      name: "schedule_message",
      description: "Schedule a message (as you) for later, up to 120 days ahead. post_at is an ISO date-time with offset, e.g. 2026-11-05T09:00:00+05:30. Always requires the user's approval.",
      input: z.object({ channel, text, post_at: z.string().refine((s) => !isNaN(Date.parse(s)), "An ISO date-time, e.g. 2026-11-05T09:00:00+05:30"), thread_ts: ts.optional() }),
      requiresApproval: true,
      summarize: (a) => `Schedule a Slack message to ${a.channel} for ${a.post_at}`,
      async prepare(a, ctx) {
        const when = Date.parse(a.post_at);
        if (when <= Date.now() + 30_000) throw new ConnectorError("That time is in the past. Pick a time in the future.", 400, "invalid");
        if (when > Date.now() + 120 * 86_400_000) throw new ConnectorError("Slack can only schedule up to 120 days ahead.", 400, "invalid");
        const where = await channelLabel(ctx, a.channel);
        return preview(`Schedule a Slack message to ${where}`, { Channel: where, When: a.post_at, Message: a.text });
      },
      async execute(a, ctx) {
        const postAt = Math.floor(Date.parse(a.post_at) / 1000);
        const j = await slack<{ scheduled_message_id?: string; post_at?: number; channel?: string }>(ctx, "chat.scheduleMessage", { json: { channel: a.channel, text: a.text, post_at: postAt, ...(a.thread_ts ? { thread_ts: a.thread_ts } : {}) } });
        return { scheduled: true, id: j.scheduled_message_id, channel: j.channel, post_at: new Date((j.post_at ?? postAt) * 1000).toISOString() };
      },
    }),
  ],
});
