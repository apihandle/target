import { BLOGGER_API_BASE, BLOGGER_ENV_VARS } from "@/lib/socialConfig";
import { blogger } from "@/lib/connectors/blogger";
import { getCredentials, listConnections, NotConnectedError } from "@/lib/connectors/store";
import { ConnectorError } from "@/lib/connectors/http";
import type { Db as AuthDb } from "@/lib/server/auth";
import type { BloggerPublishSetup } from "@/lib/server/socialPost";

/**
 * The Blogger side of social posting (migration 0025): everything that is per-user rather than site
 * configuration. The admin connects their own Google account through the standard connector OAuth flow
 * (lib/connectors/blogger.ts) — tokens are sealed in `connections` by lib/connectors/store.ts, refreshed
 * by getCredentials, and never handled here beyond the access token getCredentials returns in server
 * memory. Which blog to post to is a plain setting in social_blogger_settings (no secrets in that table).
 *
 * Two read models, deliberately separate:
 *  - bloggerReadiness / bloggerStatus: cheap status for the UI (env + connection row + chosen blog).
 *    Never decrypts anything.
 *  - resolveBloggerSetup: the publish path. Loads (and if needed refreshes) the access token and pairs
 *    it with the chosen blog, or explains in one safe sentence why publishing can't happen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const SETTINGS_TABLE = "social_blogger_settings";
export const BLOGGER_CONNECTOR_ID = blogger.id;

export type BloggerBlog = { id: string; name: string; url: string | null };
export type BloggerSettings = { blogId: string; blogName: string; blogUrl: string | null };

/** The chosen blog for this user, or null when none is picked yet. */
export async function bloggerSettings(db: Db, userId: string): Promise<BloggerSettings | null> {
  try {
    const { data, error } = await db.from(SETTINGS_TABLE).select("blog_id, blog_name, blog_url").eq("user_id", userId).maybeSingle();
    if (error || !data?.blog_id) return null;
    return { blogId: String(data.blog_id), blogName: String(data.blog_name ?? ""), blogUrl: (data.blog_url as string | null) ?? null };
  } catch {
    return null;
  }
}

/** Save/replace the chosen blog. Name/URL come from the Blogger API listing, never from the client. */
export async function saveBloggerBlog(db: Db, userId: string, blog: BloggerBlog): Promise<void> {
  const { error } = await db.from(SETTINGS_TABLE).upsert(
    { user_id: userId, blog_id: blog.id, blog_name: blog.name.slice(0, 200), blog_url: blog.url, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("Could not save the blog choice");
}

/** Forget the chosen blog (used when the Blogger connection is removed). */
export async function clearBloggerBlog(db: Db, userId: string): Promise<void> {
  const { error } = await db.from(SETTINGS_TABLE).delete().eq("user_id", userId);
  if (error) throw new Error("Could not clear the blog choice");
}

type ConnState = { state: "connected"; accountLabel: string } | { state: "missing" | "expired" | "revoked" };

async function connectionState(db: Db, userId: string): Promise<ConnState> {
  const conns = await listConnections(db as unknown as AuthDb, userId).catch(() => []);
  const c = conns.find((x) => x.connector_id === BLOGGER_CONNECTOR_ID);
  if (!c) return { state: "missing" };
  if (c.status === "connected") return { state: "connected", accountLabel: c.account_label };
  return { state: c.status };
}

/**
 * Short readiness for the status endpoint/UI, in the same fragment style as targetReadiness
 * ("META_FACEBOOK_PAGE_ID is not set"): env first, then the connection, then the chosen blog.
 */
export async function bloggerReadiness(db: Db, userId: string, env: Env = process.env): Promise<{ ready: boolean; reason?: string }> {
  const missing = BLOGGER_ENV_VARS.find((n) => !(env[n] ?? "").trim());
  if (missing) return { ready: false, reason: `${missing} is not set` };
  const conn = await connectionState(db, userId);
  if (conn.state === "missing") return { ready: false, reason: "Blogger is not connected" };
  if (conn.state !== "connected") return { ready: false, reason: "The Blogger connection has expired" };
  if (!(await bloggerSettings(db, userId))) return { ready: false, reason: "No blog is chosen yet" };
  return { ready: true };
}

export type BloggerStatus = {
  vars: { name: string; set: boolean }[];
  oauthConfigured: boolean;
  connected: boolean;
  accountLabel: string;
  blog: BloggerSettings | null;
};

/** Full Blogger block for GET /api/admin/social and the page's setup panel. Names/status only, no secrets. */
export async function bloggerStatus(db: Db, userId: string, env: Env = process.env): Promise<BloggerStatus> {
  const vars = BLOGGER_ENV_VARS.map((name) => ({ name, set: !!(env[name] ?? "").trim() }));
  const conn = await connectionState(db, userId);
  return {
    vars,
    oauthConfigured: vars.every((v) => v.set),
    connected: conn.state === "connected",
    accountLabel: conn.state === "connected" ? conn.accountLabel : "",
    blog: await bloggerSettings(db, userId),
  };
}

/**
 * The publish path: a ready setup (fresh access token + chosen blog) or one safe sentence explaining
 * why not. Token refresh, expiry marking and revocation handling all live in getCredentials — this
 * function only translates its outcomes into the publisher's shape.
 */
export async function resolveBloggerSetup(db: Db, userId: string, f: Fetch = fetch, env: Env = process.env): Promise<BloggerPublishSetup> {
  const missing = BLOGGER_ENV_VARS.find((n) => !(env[n] ?? "").trim());
  if (missing) return { ready: false, reason: `Not set up yet: ${missing} is not set. Add the missing server env vars, then try again.` };
  const settings = await bloggerSettings(db, userId);
  let accessToken: string;
  try {
    const { creds } = await getCredentials(userId, blogger, f);
    accessToken = creds.access_token;
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return e.status === "expired"
        ? { ready: false, reason: "The Blogger connection has expired. Reconnect Blogger on the Social posts page, then try again." }
        : { ready: false, reason: "Blogger is not connected. Connect it on the Social posts page, then try again." };
    }
    if (e instanceof ConnectorError) return { ready: false, reason: e.message };
    return { ready: false, reason: "Blogger couldn't be reached. Nothing was posted; try again in a moment." };
  }
  if (!settings) return { ready: false, reason: "Blogger is connected, but no blog is chosen yet. Pick the blog on the Social posts page, then try again." };
  return { ready: true, accessToken, blogId: settings.blogId, blogName: settings.blogName };
}

type BlogListReply = { items?: { id?: string; name?: string; url?: string }[]; error?: { status?: string } };

/** The user's blogs from the Blogger API (for the picker). Errors are mapped, never forwarded raw. */
export async function listBloggerBlogs(accessToken: string, f: Fetch = fetch): Promise<{ ok: true; blogs: BloggerBlog[] } | { ok: false; error: string }> {
  try {
    const r = await f(`${BLOGGER_API_BASE}/users/self/blogs`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as BlogListReply;
    if (!r.ok || j.error) {
      if (r.status === 401) return { ok: false, error: "Google rejected the Blogger access token (expired or revoked). Reconnect Blogger, then try again." };
      if (r.status === 403) return { ok: false, error: "The Blogger connection is missing the Blogger permission. Reconnect Blogger and approve it, then try again." };
      return { ok: false, error: `Blogger returned an error (HTTP ${r.status}). Try again in a moment.` };
    }
    const blogs = (j.items ?? [])
      .filter((b) => b.id)
      .map((b) => ({ id: String(b.id), name: String(b.name ?? ""), url: (b.url as string | undefined) ?? null }));
    return { ok: true, blogs };
  } catch {
    return { ok: false, error: "Couldn't reach Blogger. Try again in a moment." };
  }
}

/** Access token for the blog-listing call, or the same safe reason resolveBloggerSetup would give. */
export async function bloggerAccessToken(userId: string, f: Fetch = fetch, env: Env = process.env): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const missing = BLOGGER_ENV_VARS.find((n) => !(env[n] ?? "").trim());
  if (missing) return { ok: false, error: `${missing} is not set on the server yet.` };
  try {
    const { creds } = await getCredentials(userId, blogger, f);
    return { ok: true, accessToken: creds.access_token };
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return e.status === "expired"
        ? { ok: false, error: "The Blogger connection has expired. Reconnect Blogger, then try again." }
        : { ok: false, error: "Blogger is not connected yet." };
    }
    if (e instanceof ConnectorError) return { ok: false, error: e.message };
    return { ok: false, error: "Blogger couldn't be reached. Try again in a moment." };
  }
}
