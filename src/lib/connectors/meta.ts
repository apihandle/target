import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch } from "@/lib/connectors/http";
import type { ConnectorDef, OAuthConfig, ToolContext } from "@/lib/connectors/types";
import { DEFAULT_GRAPH_VERSION, META_SCOPES, metaGraphVersion } from "@/lib/socialConfig";

/**
 * Meta (Facebook + Instagram), per user — phase 2 of social posting. Unlike v1's env-configured owner
 * Page, every signed-in user now connects their OWN Facebook account with Facebook Login and picks
 * which of their Pages TARGET may post to; the Instagram card is driven by the professional account
 * linked to that Page. One connection drives both cards, so the credentials live in a single
 * `connections` row under the provider id "meta" (the `meta` def below — deliberately NOT in the
 * registry list; the registry carries the two display defs `facebook` and `instagram`, whose status
 * connectorViews derives from the meta row).
 *
 * The OAuth flow itself is NOT the generic connector flow: Facebook returns a short-lived user token
 * that must be exchanged for a long-lived one, so dedicated routes (/api/connectors/meta/start and
 * /api/connectors/meta/callback) run it and store the long-lived token sealed via saveConnection,
 * exactly like every other provider secret. The chosen Page's access token and the linked Instagram
 * user id are kept in the credentials' `meta` bag (server-only), mirroring how Vercel keeps its team
 * id there. Only the app itself is server configuration: META_APP_ID / META_APP_SECRET.
 */
const graphBase = (env: Record<string, string | undefined>) => `https://graph.facebook.com/${metaGraphVersion(env)}`;

const oauthCfg: OAuthConfig = {
  authorizeUrl: `https://www.facebook.com/${DEFAULT_GRAPH_VERSION}/dialog/oauth`,
  tokenUrl: `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/oauth/access_token`,
  clientIdEnv: "META_APP_ID",
  clientSecretEnv: "META_APP_SECRET",
  tokenAuth: "body",
  // Facebook user tokens are exchanged for long-lived ones at connect time instead of refreshed.
  refreshable: false,
  async revoke(creds, env, f) {
    // Best effort: drop the app's permissions for this user. The local row is deleted regardless.
    await f(`${graphBase(env)}/me/permissions?access_token=${encodeURIComponent(creds.access_token)}`, { method: "DELETE" }).catch(() => undefined);
  },
};

const DOCS = [
  "https://developers.facebook.com/docs/facebook-login",
  "https://developers.facebook.com/docs/pages-api",
  "https://developers.facebook.com/docs/instagram-platform/content-publishing",
];

const TODO = [
  "Owner: create (or reuse) a Meta app with the Facebook Login product, register the redirect URI <site origin>/api/connectors/meta/callback, and set META_APP_ID / META_APP_SECRET on the server.",
  "While the Meta app is in development mode only people with a role in the app can connect; publishing for everyone needs Meta App Review for pages_manage_posts and instagram_content_publish.",
];

/** The stored-connection definition (provider id "meta"). Server code only; not a Connectors-page card. */
export const meta = defineConnector({
  id: "meta",
  name: "Meta",
  icon: "M",
  description: "Your Facebook Pages and their linked Instagram accounts, for social posting.",
  auth: "oauth",
  scopes: [...META_SCOPES],
  capabilities: ["List your Facebook Pages and post to the one you pick", "Post to the Instagram account linked to that Page"],
  permissions: [
    "meta: see your Facebook Pages, publish posts to the Page you pick, and publish to its linked Instagram account. TARGET never reads your personal profile posts, messages or friends.",
  ],
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  oauth: oauthCfg,
  docs: DOCS,
  todo: TODO,
  getTools: () => [],
});

const pageToken = (ctx: ToolContext): string =>
  typeof ctx.meta.page_access_token === "string" && ctx.meta.page_access_token ? ctx.meta.page_access_token : ctx.token;

export const facebook = defineConnector({
  id: "facebook",
  name: "Facebook",
  icon: "f",
  description: "Your Facebook Page: connect with Facebook Login, pick the Page, and the social composer can post to it.",
  auth: "oauth",
  scopes: [...META_SCOPES],
  capabilities: [
    "See the Facebook Page you picked (name and id)",
    "Publish posts to that Page from the social composer",
  ],
  permissions: [
    "facebook: see your Facebook Pages and publish posts to the one you pick. TARGET never reads your personal profile posts, messages or friends.",
    "Connecting signs you in with Facebook and connects your Instagram card at the same time — one Meta connection drives both.",
  ],
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  oauth: oauthCfg,
  docs: DOCS,
  todo: TODO,
  getTools: () => [
    tool({
      name: "page_info",
      description: "Show the Facebook Page this user picked for social posting (id, name, link).",
      input: z.object({}),
      async execute(_a, ctx) {
        const pageId = typeof ctx.meta.page_id === "string" ? ctx.meta.page_id : "";
        if (!pageId) return { connected: true, page: null, note: "No Page is picked yet. Pick one on the Connectors page." };
        const j = await apiFetch<{ id?: string; name?: string; link?: string }>(
          `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=id,name,link`,
          { f: ctx.fetch, headers: { Authorization: `Bearer ${pageToken(ctx)}` } },
        );
        return { connected: true, page: { id: j.id ?? pageId, name: j.name ?? "", link: j.link ?? "" } };
      },
    }),
  ],
});

export const instagram = defineConnector({
  id: "instagram",
  name: "Instagram",
  icon: "IG",
  description: "The Instagram professional account linked to your Facebook Page: the social composer can post to it.",
  auth: "oauth",
  scopes: [...META_SCOPES],
  capabilities: [
    "See the Instagram account linked to your picked Page",
    "Publish posts to that Instagram account from the social composer",
  ],
  permissions: [
    "instagram: see and publish to the Instagram professional account linked to your Facebook Page. TARGET never reads your direct messages or followers.",
    "Connecting signs you in with Facebook and connects your Facebook card at the same time — one Meta connection drives both.",
  ],
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  oauth: oauthCfg,
  docs: DOCS,
  todo: TODO,
  getTools: () => [
    tool({
      name: "account_info",
      description: "Show the Instagram account linked to the Facebook Page this user picked (id, username).",
      input: z.object({}),
      async execute(_a, ctx) {
        const igId = typeof ctx.meta.ig_user_id === "string" ? ctx.meta.ig_user_id : "";
        if (!igId) return { connected: true, account: null, note: "No Instagram account is linked to the picked Page." };
        const j = await apiFetch<{ id?: string; username?: string }>(
          `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/${encodeURIComponent(igId)}?fields=id,username`,
          { f: ctx.fetch, headers: { Authorization: `Bearer ${pageToken(ctx)}` } },
        );
        return { connected: true, account: { id: j.id ?? igId, username: j.username ?? "" } };
      },
    }),
  ],
});

/** Display defs registered for the Connectors page; both are fed by the single "meta" connection. */
export const META_DISPLAY_DEFS: ConnectorDef[] = [facebook, instagram];
