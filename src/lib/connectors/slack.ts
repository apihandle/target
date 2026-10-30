import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/** Slack, via the Web API with a bot token from OAuth v2. */
async function slack<T = Record<string, unknown>>(ctx: ToolContext, method: string, body?: Record<string, unknown>): Promise<T> {
  const j = await apiFetch<Record<string, unknown>>(`https://slack.com/api/${method}`, {
    method: body ? "POST" : "GET", f: ctx.fetch, body, headers: { Authorization: `Bearer ${ctx.token}`, ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}) },
  });
  if (j.ok === false) throw new ConnectorError(`Slack: ${String(j.error ?? "request failed")}`, 400);
  return j as T;
}

export const slackConnector = defineConnector({
  id: "slack",
  name: "Slack",
  icon: "#",
  description: "Post messages to Slack channels.",
  auth: "oauth",
  scopes: ["chat:write", "channels:read"],
  capabilities: ["List public channels", "Send a message to a channel the TARGET app was added to (asks you first)"],
  permissions: [
    "chat:write: post messages as the TARGET app in channels it has been added to.",
    "channels:read: see the names of public channels.",
    "Every message waits for your approval. Remove the app any time in Slack → Settings → Manage apps.",
  ],
  requiredEnv: ["SLACK_OAUTH_CLIENT_ID", "SLACK_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    scopeSeparator: ",",
    refreshable: true,
    async accountLabel(_t, j) {
      const team = j.team as { name?: string } | undefined;
      return team?.name ? `Workspace: ${team.name}` : "";
    },
    async revoke(creds, _env, f) {
      await f("https://slack.com/api/auth.revoke", { method: "POST", headers: { Authorization: `Bearer ${creds.access_token}` } }).catch(() => undefined);
    },
  },
  docs: ["https://api.slack.com/authentication/oauth-v2", "https://api.slack.com/methods/chat.postMessage", "https://api.slack.com/methods/auth.revoke"],
  todo: ["Reading channel history (needs channels:history) is not implemented.", "Posting as the user (user token) is not implemented; messages post as the bot."],
  getTools: () => [
    tool({
      name: "list_channels",
      description: "List public Slack channels (id, name, whether the app is a member).",
      input: z.object({}),
      async execute(_a, ctx) {
        const j = await slack<{ channels?: Record<string, unknown>[] }>(ctx, "conversations.list?types=public_channel&exclude_archived=true&limit=200");
        return (j.channels ?? []).map((c) => ({ id: c.id, name: c.name, is_member: c.is_member }));
      },
    }),
    tool({
      name: "send_message",
      description: "Send a message to a Slack channel. Always requires the user's approval.",
      input: z.object({ channel: z.string().regex(/^[A-Z0-9]{8,12}$/, "Channel id, e.g. C0123456789"), text: z.string().min(1).max(4000) }),
      requiresApproval: true,
      summarize: (a) => `Send a Slack message to channel ${a.channel}`,
      async execute(a, ctx) {
        const j = await slack<{ ts?: string; channel?: string }>(ctx, "chat.postMessage", { channel: a.channel, text: a.text });
        return { sent: true, channel: j.channel, ts: j.ts };
      },
    }),
  ],
});
