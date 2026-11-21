import { META_SCOPES, metaGraphVersion, type MetaTarget } from "@/lib/socialConfig";
import { meta } from "@/lib/connectors/meta";
import { getStoredCredentials, listConnections, saveConnection } from "@/lib/connectors/store";
import type { ConnectorView } from "@/lib/connectors/registry";
import type { Db as AuthDb } from "@/lib/server/auth";
import { metaConfig, targetReadiness, type MetaConfig } from "@/lib/server/socialPost";

/**
 * The Meta side of social posting, phase 2 (per user): everything that resolves a signed-in user's
 * OWN Facebook Page + linked Instagram account for the composer, the Connectors cards and the
 * scheduled-post runner. Mirrors lib/server/socialBlogger.ts:
 *  - metaStatus / metaPublicInfo / metaTargetReadiness: cheap status for the UI. Names and ids only —
 *    never a token.
 *  - resolveMetaSetup: the publish path. Turns the user's sealed "meta" connection (long-lived user
 *    token + the picked Page's access token, both stored by lib/connectors/store.ts) into the
 *    MetaConfig the publisher already takes, or explains in one safe sentence why it can't.
 *
 * Fallback rule (the safety property of this module): the env-configured owner Page
 * (META_FACEBOOK_PAGE_ID / META_FACEBOOK_PAGE_ACCESS_TOKEN, v1) is used ONLY when the user has no
 * Meta connection at all — callers that serve non-admin users must additionally check the returned
 * `source` (see /api/social/publish). A user who connected Meta but hasn't picked a Page yet gets a
 * "pick a Page" failure, never a silent post to the owner's Page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export const META_CONNECTOR_ID = meta.id;

export type MetaPageRef = { id: string; name: string };
export type MetaInstagramRef = { id: string; username: string };
/** A Page from the Graph listing, internal shape (includes the Page access token — server-only). */
export type MetaPage = MetaPageRef & { accessToken: string; instagram: MetaInstagramRef | null };
/** The same Page as the API returns it to the client: the token is never included. */
export type MetaPagePublic = MetaPageRef & { instagram: MetaInstagramRef | null };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The picked Page / linked Instagram stored in the connection's sealed meta bag, if any. */
function pageFromMeta(m: Record<string, unknown> | undefined): MetaPageRef | null {
  const id = str(m?.page_id);
  return id ? { id, name: str(m?.page_name) } : null;
}
function instagramFromMeta(m: Record<string, unknown> | undefined): MetaInstagramRef | null {
  const id = str(m?.ig_user_id);
  return id ? { id, username: str(m?.ig_username) } : null;
}

export type MetaStatus = {
  /** META_APP_ID / META_APP_SECRET are set, so the connect flow can run at all. */
  appConfigured: boolean;
  connected: boolean;
  /** The connection row exists but is no longer usable (expired/revoked at Meta). */
  expired: boolean;
  /** Facebook user name from connect time, or the picked Page's name after a pick. */
  accountLabel: string;
  page: MetaPageRef | null;
  instagram: MetaInstagramRef | null;
};

/** Full Meta block for GET /api/social/meta. Names/status only, no secrets. */
export async function metaStatus(db: Db, userId: string, env: Env = process.env): Promise<MetaStatus> {
  const appConfigured = !!(env.META_APP_ID ?? "").trim() && !!(env.META_APP_SECRET ?? "").trim();
  const conns = await listConnections(db as unknown as AuthDb, userId).catch(() => []);
  const row = conns.find((x) => x.connector_id === META_CONNECTOR_ID);
  if (!row) return { appConfigured, connected: false, expired: false, accountLabel: "", page: null, instagram: null };
  if (row.status !== "connected") return { appConfigured, connected: false, expired: true, accountLabel: row.account_label, page: null, instagram: null };
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID).catch(() => null);
  const m = stored?.creds.meta;
  return {
    appConfigured,
    connected: true,
    expired: false,
    accountLabel: row.account_label,
    page: pageFromMeta(m),
    instagram: instagramFromMeta(m),
  };
}

export type MetaPublicInfo = {
  accountLabel: string;
  page: MetaPageRef | null;
  instagram: MetaInstagramRef | null;
};

/**
 * What the Connectors cards may show for this user (Page name for the Facebook card, @username — or
 * the explicit "no Instagram linked" state — for the Instagram card). Null when Meta isn't connected.
 */
export async function metaPublicInfo(userId: string): Promise<MetaPublicInfo | null> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID).catch(() => null);
  if (!stored) return null;
  return {
    accountLabel: stored.info.account_label,
    page: pageFromMeta(stored.creds.meta),
    instagram: instagramFromMeta(stored.creds.meta),
  };
}

/** Pure: fold metaPublicInfo into connector views (the sealed bag is the only place the IG username lives). */
export function patchMetaViews(views: ConnectorView[], info: MetaPublicInfo | null): ConnectorView[] {
  if (!info) return views;
  return views.map((v) => {
    if (v.id === "facebook") return { ...v, status: "connected" as const, accountLabel: info.page?.name || info.accountLabel || undefined };
    if (v.id === "instagram") {
      return {
        ...v,
        status: "connected" as const,
        accountLabel: info.instagram
          ? `@${info.instagram.username || info.instagram.id}`
          : info.page
            ? "No Instagram linked to this Page"
            : "Pick a Page to link Instagram",
      };
    }
    return v;
  });
}

/**
 * Per-target readiness for the composer, in the same fragment style as targetReadiness /
 * bloggerReadiness. With `envFallback` (admin/owner contexts) a user with no connection of their own
 * sees the env-configured owner Page's readiness, exactly as v1; without it, Meta targets stay off
 * until the user connects their own account.
 */
export async function metaTargetReadiness(
  userId: string,
  env: Env = process.env,
  opts: { envFallback?: boolean } = {},
): Promise<Record<MetaTarget, { ready: boolean; reason?: string }>> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID).catch(() => null);
  if (!stored) {
    if (opts.envFallback) return targetReadiness(metaConfig(env));
    const appConfigured = !!(env.META_APP_ID ?? "").trim() && !!(env.META_APP_SECRET ?? "").trim();
    const reason = appConfigured
      ? "Connect Facebook on the Connectors page first"
      : "Meta is not set up on this server yet";
    return { facebook: { ready: false, reason }, instagram: { ready: false, reason } };
  }
  if (stored.creds.expires_at && stored.creds.expires_at < Date.now()) {
    const reason = "Your Meta connection has expired — reconnect Facebook";
    return { facebook: { ready: false, reason }, instagram: { ready: false, reason } };
  }
  const page = pageFromMeta(stored.creds.meta);
  if (!page) {
    const reason = "Pick the Facebook Page to post to on the Connectors page";
    return { facebook: { ready: false, reason }, instagram: { ready: false, reason } };
  }
  const ig = instagramFromMeta(stored.creds.meta);
  return {
    facebook: { ready: true },
    instagram: ig ? { ready: true } : { ready: false, reason: "No Instagram account is linked to that Page" },
  };
}

export type MetaPublishSetup =
  | { ready: true; cfg: MetaConfig; source: "user" | "env" }
  | { ready: false; reason: string };

/**
 * The publish path: the posting user's own MetaConfig, the env owner config as fallback (only when
 * the user never connected Meta — see the module comment), or one safe sentence explaining why not.
 */
export async function resolveMetaSetup(userId: string, env: Env = process.env): Promise<MetaPublishSetup> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID).catch(() => null);
  if (!stored) return { ready: true, cfg: metaConfig(env), source: "env" };
  if (stored.creds.expires_at && stored.creds.expires_at < Date.now()) {
    return { ready: false, reason: "Your Meta connection has expired. Reconnect Facebook on the Connectors page, then try again." };
  }
  const m = stored.creds.meta ?? {};
  const page = pageFromMeta(m);
  if (!page) {
    return { ready: false, reason: "Meta is connected, but no Facebook Page is chosen yet. Pick the Page on the Connectors page, then try again." };
  }
  const pageToken = str(m.page_access_token);
  if (!pageToken) {
    return { ready: false, reason: "The picked Page's access token is missing. Reconnect Facebook and pick the Page again." };
  }
  const ig = instagramFromMeta(m);
  return {
    ready: true,
    source: "user",
    cfg: {
      pageId: page.id,
      pageToken,
      igUserId: ig?.id ?? "",
      appId: (env.META_APP_ID ?? "").trim(),
      graphVersion: metaGraphVersion(env),
      missing: [],
    },
  };
}

/**
 * The guard the user-level routes (/api/social/publish, /api/social/schedule) apply before any Meta
 * target is accepted: the caller's own setup wins; the env owner config is honoured only for the
 * site owner (admin). A regular user without their own connection gets the connect-first error.
 */
export async function userMetaConfig(
  userId: string,
  isAdmin: boolean,
  env: Env = process.env,
): Promise<{ ok: true; cfg: MetaConfig } | { ok: false; error: string }> {
  const setup = await resolveMetaSetup(userId, env);
  if (!setup.ready) return { ok: false, error: setup.reason };
  if (setup.source === "env" && !isAdmin) {
    return { ok: false, error: "Connect your own Facebook account on the Connectors page and pick your Page first — posts from here go to your own accounts only." };
  }
  return { ok: true, cfg: setup.cfg };
}

type AccountsReply = {
  data?: { id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }[];
  error?: { code?: number };
};

/**
 * The user's Pages from the Graph API (for the picker and for verifying a pick server-side). Errors
 * are mapped, never forwarded raw. The returned access tokens stay server-side: routes must map to
 * MetaPagePublic before answering the client.
 */
export async function listMetaPages(accessToken: string, f: Fetch = fetch, env: Env = process.env): Promise<{ ok: true; pages: MetaPage[] } | { ok: false; error: string }> {
  try {
    const fields = "id,name,access_token,instagram_business_account{id,username}";
    const r = await f(`https://graph.facebook.com/${metaGraphVersion(env)}/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as AccountsReply;
    if (!r.ok || j.error) {
      if (r.status === 401 || j.error?.code === 190) return { ok: false, error: "Meta rejected the access token (expired or revoked). Reconnect Facebook, then try again." };
      if (r.status === 403 || j.error?.code === 200 || j.error?.code === 10) return { ok: false, error: "The Meta connection is missing a Page permission. Reconnect Facebook and approve the Page permissions, then try again." };
      return { ok: false, error: `Meta returned an error (HTTP ${r.status}). Try again in a moment.` };
    }
    const pages = (j.data ?? [])
      .filter((p) => p.id && p.access_token)
      .map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        accessToken: String(p.access_token),
        instagram: p.instagram_business_account?.id
          ? { id: String(p.instagram_business_account.id), username: String(p.instagram_business_account.username ?? "") }
          : null,
      }));
    return { ok: true, pages };
  } catch {
    return { ok: false, error: "Couldn't reach Meta. Try again in a moment." };
  }
}

/** The user's long-lived Meta access token, or the same safe reason style as the Blogger twin. */
export async function metaAccessToken(userId: string): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID).catch(() => null);
  if (!stored) return { ok: false, error: "Meta is not connected yet." };
  if (stored.creds.expires_at && stored.creds.expires_at < Date.now()) {
    return { ok: false, error: "Your Meta connection has expired. Reconnect Facebook, then try again." };
  }
  return { ok: true, accessToken: stored.creds.access_token };
}

/**
 * Store the user's Page choice inside the sealed connection: the Page's access token + id and the
 * linked Instagram account go into the credentials' meta bag (server-only), and the row's
 * account_label becomes the Page name so the Facebook card names it. The page object must come from
 * a fresh server-side listMetaPages call — never from the client.
 */
export async function saveMetaPageChoice(userId: string, page: MetaPage): Promise<void> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID);
  if (!stored) throw new Error("Meta is not connected");
  const bag: Record<string, unknown> = {
    ...(stored.creds.meta ?? {}),
    page_id: page.id,
    page_name: page.name,
    page_access_token: page.accessToken,
    ig_user_id: page.instagram?.id,
    ig_username: page.instagram?.username,
  };
  await saveConnection(userId, META_CONNECTOR_ID, {
    creds: { ...stored.creds, meta: bag },
    accountLabel: page.name || stored.info.account_label,
    scopes: stored.info.scopes.length ? stored.info.scopes : [...META_SCOPES],
  });
}

/** Forget the Page choice (the connection itself stays; disconnect removes the whole row). */
export async function clearMetaPageChoice(userId: string): Promise<void> {
  const stored = await getStoredCredentials(userId, META_CONNECTOR_ID);
  if (!stored) throw new Error("Meta is not connected");
  const bag = { ...(stored.creds.meta ?? {}) };
  delete bag.page_id;
  delete bag.page_name;
  delete bag.page_access_token;
  delete bag.ig_user_id;
  delete bag.ig_username;
  await saveConnection(userId, META_CONNECTOR_ID, {
    creds: { ...stored.creds, meta: bag },
    accountLabel: str(bag.fb_user_name) || stored.info.account_label,
    scopes: stored.info.scopes,
  });
}

/** Map an internal Page to the client-safe shape (no token). */
export const metaPagePublic = (p: MetaPage): MetaPagePublic => ({ id: p.id, name: p.name, instagram: p.instagram });
