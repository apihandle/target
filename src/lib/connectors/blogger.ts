import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";
import { BLOGGER_API_BASE, BLOGGER_SCOPE, textToHtmlParagraphs } from "@/lib/socialConfig";

/**
 * Blogger, via the Blogger API v3 (https://developers.google.com/blogger/docs/3.0) and Google OAuth 2.0.
 *
 * This connector exists so the social composer (/admin/social) can publish to a Blogger blog as a third
 * destination next to TARGET's Facebook Page and Instagram (see DESIGN.md, "Blogger destination"). Its
 * tokens live in `connections` like every other provider's — the social publisher resolves them through
 * the normal store (lib/server/socialBlogger.ts), and the tools below expose the same capability to the
 * agent. Posting always goes through the OAuth token: the Blogger API has no API-key posting.
 *
 * A separate OAuth client (BLOGGER_OAUTH_CLIENT_ID / BLOGGER_OAUTH_CLIENT_SECRET) from the main Google
 * connector's, on purpose: the consent screen asks for the Blogger scope alone, and the Blogger API is
 * enabled on that client’s Google Cloud project. The redirect URI to register for it is
 * <site origin>/api/connectors/blogger/callback.
 */
const authHeaders = (ctx: ToolContext): Record<string, string> => ({ Authorization: `Bearer ${ctx.token}` });

type Blog = { id?: string; name?: string; url?: string; posts?: { totalItems?: number } };
type BlogList = { items?: Blog[] };
type Post = { id?: string; url?: string; title?: string; published?: string };

const blogOut = (b: Blog) => ({ id: String(b.id ?? ""), name: b.name ?? "", url: b.url ?? "", posts: b.posts?.totalItems });

export const blogger = defineConnector({
  id: "blogger",
  name: "Blogger",
  icon: "B",
  description: "Your Blogger blogs: list them and publish posts. The social composer also uses this connection to cross-post to your chosen blog.",
  auth: "oauth",
  scopes: [BLOGGER_SCOPE],
  capabilities: [
    "List your Blogger blogs (name, address, post count)",
    "Publish a post to one of your blogs (asks you first)",
  ],
  permissions: [
    "blogger: see your Blogger blogs and publish posts to them. TARGET never edits or deletes existing posts.",
    "You can untick permissions on Google's consent screen; TARGET then asks you to reconnect when a task needs one. Revoke any time at myaccount.google.com/permissions.",
  ],
  requiredEnv: ["BLOGGER_OAUTH_CLIENT_ID", "BLOGGER_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "BLOGGER_OAUTH_CLIENT_ID",
    clientSecretEnv: "BLOGGER_OAUTH_CLIENT_SECRET",
    tokenAuth: "body",
    pkce: true,
    refreshable: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    async accountLabel(_t, j) {
      if (typeof j.id_token !== "string") return "";
      try { return String(JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email ?? ""); } catch { return ""; }
    },
    async revoke(creds, _env, f) {
      const t = creds.refresh_token ?? creds.access_token;
      await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
    },
  },
  docs: [
    "https://developers.google.com/blogger/docs/3.0",
    "https://developers.google.com/blogger/docs/3.0/using",
    "https://developers.google.com/identity/protocols/oauth2/web-server",
  ],
  todo: [
    "Owner: create a Google Cloud OAuth client (Web application) with the Blogger API enabled, add the redirect URI <site origin>/api/connectors/blogger/callback, and set BLOGGER_OAUTH_CLIENT_ID / BLOGGER_OAUTH_CLIENT_SECRET.",
    "The blogger scope is a sensitive scope; until Google verifies the app, the consent screen shows an \"unverified app\" warning and the client is capped at 100 users.",
  ],
  getTools: () => [
    tool({
      name: "list_blogs",
      description: "List the signed-in user's Blogger blogs (id, name, address, post count).",
      input: z.object({}),
      async execute(_a, ctx) {
        const j = await apiFetch<BlogList>(`${BLOGGER_API_BASE}/users/self/blogs`, { f: ctx.fetch, headers: authHeaders(ctx) });
        return { blogs: (j.items ?? []).map(blogOut) };
      },
    }),
    tool({
      name: "create_post",
      description: "Publish a post to one of the user's Blogger blogs. The body is plain text; it is converted to simple HTML paragraphs. Always requires the user's approval.",
      input: z.object({
        blog_id: z.string().min(1).max(100).describe("Blog id from list_blogs"),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(20000).describe("Post body as plain text (blank line = new paragraph)"),
      }),
      requiresApproval: true,
      summarize: (a) => `Publish a Blogger post: "${a.title}"`,
      async prepare(a, ctx) {
        const j = await apiFetch<BlogList>(`${BLOGGER_API_BASE}/users/self/blogs`, { f: ctx.fetch, headers: authHeaders(ctx) }).catch(() => ({ items: [] as Blog[] }));
        const blog = (j.items ?? []).find((b) => String(b.id) === a.blog_id);
        if (!blog) throw new ConnectorError("That blog wasn't found on this Blogger account. Ask for list_blogs to pick one.", 404, "not_found");
        return {
          summary: `Publish "${a.title}" to the Blogger blog "${blog.name ?? a.blog_id}"`,
          details: { Blog: String(blog.name ?? a.blog_id), Title: a.title, Post: a.body.slice(0, 500) },
          warning: "The post goes live immediately under your name.",
        };
      },
      async execute(a, ctx) {
        const p = await apiFetch<Post>(`${BLOGGER_API_BASE}/blogs/${encodeURIComponent(a.blog_id)}/posts`, {
          method: "POST", f: ctx.fetch, headers: authHeaders(ctx),
          body: { kind: "blogger#post", blog: { id: a.blog_id }, title: a.title, content: textToHtmlParagraphs(a.body) },
        });
        return { published: true, id: p.id, url: p.url, title: p.title };
      },
    }),
  ],
});
