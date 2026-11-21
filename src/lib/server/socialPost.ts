import {
  BLOGGER_API_BASE, DEFAULT_GRAPH_VERSION, META_REQUIRED_VARS, SOCIAL_MESSAGE_MAX, SOCIAL_TITLE_MAX,
  escapeHtmlText, isHttpsUrl, textToHtmlParagraphs,
  type MetaTarget, type SocialTarget,
} from "@/lib/socialConfig";

/**
 * Server side of social posting: publishing to a Facebook Page and its linked Instagram account
 * through the Meta Graph API, and to the poster's chosen Blogger blog through the Blogger API v3. The
 * Meta config is resolved by the caller per posting user (lib/server/socialMeta.ts: their own sealed
 * connection first, the env-configured owner Page as the owner's fallback) and passed in as a
 * MetaConfig; the Blogger access token is per-user OAuth, resolved by the caller through
 * lib/server/socialBlogger.ts and passed in as a BloggerPublishSetup. Neither token is ever returned,
 * logged or copied into an error string, and provider error bodies are mapped to short explanations
 * instead of being forwarded.
 */
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type MetaConfig = {
  pageId: string;
  pageToken: string;
  igUserId: string;
  appId: string;
  graphVersion: string;
  /** Env var names that are unset/empty, in declaration order. Values are never included. */
  missing: string[];
};

export function metaConfig(env: Env = process.env): MetaConfig {
  const get = (n: string) => (env[n] ?? "").trim();
  const missing = META_REQUIRED_VARS.filter((n) => !get(n));
  if (!get("META_INSTAGRAM_USER_ID")) missing.push("META_INSTAGRAM_USER_ID");
  return {
    pageId: get("META_FACEBOOK_PAGE_ID"),
    pageToken: get("META_FACEBOOK_PAGE_ACCESS_TOKEN"),
    igUserId: get("META_INSTAGRAM_USER_ID"),
    appId: get("META_APP_ID"),
    graphVersion: get("META_GRAPH_API_VERSION") || DEFAULT_GRAPH_VERSION,
    missing,
  };
}

/** Per-target readiness of the two Meta targets for the status endpoint/UI. Reasons name the missing variable, never a value. (Blogger readiness is per-user — see bloggerReadiness in socialBlogger.ts.) */
export function targetReadiness(cfg: MetaConfig): Record<MetaTarget, { ready: boolean; reason?: string }> {
  const base = !cfg.pageId
    ? "META_FACEBOOK_PAGE_ID is not set"
    : !cfg.pageToken
      ? "META_FACEBOOK_PAGE_ACCESS_TOKEN is not set"
      : null;
  return {
    facebook: base ? { ready: false, reason: base } : { ready: true },
    instagram: base
      ? { ready: false, reason: base }
      : !cfg.igUserId
        ? { ready: false, reason: "META_INSTAGRAM_USER_ID is not set" }
        : { ready: true },
  };
}

export type SocialPostInput = { message: string; link?: string; imageUrl?: string; title?: string };
export type TargetResult =
  | { target: SocialTarget; ok: true; id: string; url?: string }
  | { target: SocialTarget; ok: false; error: string };

const TIMEOUT = 20000;
const graphBase = (cfg: MetaConfig) => `https://graph.facebook.com/${cfg.graphVersion}`;

type GraphReply = { id?: string; post_id?: string; status_code?: string; error?: { message?: string; code?: number } };

/** An error whose message is already a safe, mapped explanation (graphErrorText) — safe to show as-is. */
class GraphError extends Error {}

async function graphPost(cfg: MetaConfig, path: string, fields: Record<string, string>, f: Fetch): Promise<GraphReply> {
  const body = new URLSearchParams({ ...fields, access_token: cfg.pageToken });
  const r = await f(`${graphBase(cfg)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as GraphReply;
  if (!r.ok || j.error) throw new GraphError(graphErrorText(j, r.status));
  return j;
}

async function graphGet(cfg: MetaConfig, path: string, f: Fetch): Promise<GraphReply> {
  const q = new URLSearchParams({ access_token: cfg.pageToken });
  const r = await f(`${graphBase(cfg)}${path}?${q}`, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as GraphReply;
  if (!r.ok || j.error) throw new GraphError(graphErrorText(j, r.status));
  return j;
}

/** Map a Graph error to a short, safe explanation. The raw provider message is never forwarded as-is. */
function graphErrorText(j: GraphReply, status: number): string {
  const code = j.error?.code;
  if (code === 190) return "Meta rejected the Page access token (expired or revoked). Mint a fresh long-lived Page token and update META_FACEBOOK_PAGE_ACCESS_TOKEN.";
  if (code === 200 || code === 10 || status === 403) return "The Page token is missing a publishing permission (pages_manage_posts / instagram_content_publish), or the app is not allowed to post to this account.";
  if (status === 404) return "Meta could not find that Page or Instagram account id. Check META_FACEBOOK_PAGE_ID / META_INSTAGRAM_USER_ID.";
  return `Meta returned an error (HTTP ${status}${code ? `, code ${code}` : ""}). Nothing was confirmed as posted; check the account before retrying.`;
}

function netError(e: unknown): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "Meta didn't answer in time. Nothing was confirmed as posted; check the account before retrying.";
  if (e instanceof GraphError) return e.message; // already a mapped, safe explanation
  return "Couldn't reach Meta. Nothing was confirmed as posted; check the account before retrying.";
}

/** Facebook Page: photo post when an image URL is given, otherwise a feed post (message + optional link). */
export async function publishToFacebook(cfg: MetaConfig, input: SocialPostInput, f: Fetch = fetch): Promise<TargetResult> {
  try {
    if (input.imageUrl) {
      const j = await graphPost(cfg, `/${cfg.pageId}/photos`, { url: input.imageUrl, caption: input.message }, f);
      const id = j.post_id ?? j.id;
      if (!id) return { target: "facebook", ok: false, error: "Meta answered without a post id. Check the Page before retrying." };
      return { target: "facebook", ok: true, id, url: `https://www.facebook.com/${id}` };
    }
    const fields: Record<string, string> = { message: input.message };
    if (input.link) fields.link = input.link;
    const j = await graphPost(cfg, `/${cfg.pageId}/feed`, fields, f);
    if (!j.id) return { target: "facebook", ok: false, error: "Meta answered without a post id. Check the Page before retrying." };
    return { target: "facebook", ok: true, id: j.id, url: `https://www.facebook.com/${j.id}` };
  } catch (e) {
    return { target: "facebook", ok: false, error: netError(e) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Instagram: two-step container flow. The image must be at a publicly reachable https URL — the API fetches
 * it itself and cannot accept an upload. Polls the container briefly (images are normally ready at once);
 * if it never reaches FINISHED, nothing is published and the caller is told to retry.
 */
export async function publishToInstagram(
  cfg: MetaConfig,
  input: SocialPostInput,
  f: Fetch = fetch,
  opts: { polls?: number; pollMs?: number } = {},
): Promise<TargetResult> {
  if (!input.imageUrl) return { target: "instagram", ok: false, error: "Instagram needs a public image URL — it has no text-only posts. Add an image URL and try again." };
  try {
    const created = await graphPost(cfg, `/${cfg.igUserId}/media`, { image_url: input.imageUrl, caption: input.message }, f);
    if (!created.id) return { target: "instagram", ok: false, error: "Meta answered without a media container id. Check Instagram before retrying." };
    const polls = opts.polls ?? 5;
    const pollMs = opts.pollMs ?? 2000;
    let finished = false;
    for (let i = 0; i < polls; i++) {
      const st = await graphGet(cfg, `/${created.id}?fields=status_code`, f);
      if (st.status_code === "FINISHED") { finished = true; break; }
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
        return { target: "instagram", ok: false, error: "Instagram couldn't process that image (the URL must be public, https and a direct image file). Nothing was published." };
      }
      if (i < polls - 1) await sleep(pollMs);
    }
    if (!finished) return { target: "instagram", ok: false, error: "Instagram is still processing the image. Nothing was published yet — wait a moment and try again." };
    const published = await graphPost(cfg, `/${cfg.igUserId}/media_publish`, { creation_id: created.id }, f);
    if (!published.id) return { target: "instagram", ok: false, error: "Meta answered without a media id. Check Instagram before retrying." };
    return { target: "instagram", ok: true, id: published.id };
  } catch (e) {
    return { target: "instagram", ok: false, error: netError(e) };
  }
}

/**
 * What the caller resolved for the Blogger destination (lib/server/socialBlogger.ts): either a usable
 * access token + the chosen blog, or the reason it can't publish — a complete, user-safe sentence that
 * never contains token material. Resolved per user because the token is the admin's own OAuth grant.
 */
export type BloggerPublishSetup =
  | { ready: true; accessToken: string; blogId: string; blogName: string }
  | { ready: false; reason: string };

/**
 * The composer's content mapping for Blogger (a blog post needs a title + HTML body, unlike a caption):
 *  - title: the explicit title field when given, else the first non-empty line of the text (capped);
 *  - body: the optional image first, then the full text as HTML paragraphs (blank line = new paragraph,
 *    single newline = <br>, everything escaped), then the optional link as its own paragraph.
 */
export function bloggerPostContent(input: SocialPostInput): { title: string; content: string } {
  const explicit = (input.title ?? "").trim();
  const firstLine = input.message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = (explicit || firstLine).slice(0, SOCIAL_TITLE_MAX) || "Untitled";
  const parts: string[] = [];
  if (input.imageUrl) parts.push(`<p><img src="${escapeHtmlText(input.imageUrl)}" alt=""></p>`);
  const body = textToHtmlParagraphs(input.message);
  if (body) parts.push(body);
  if (input.link) parts.push(`<p><a href="${escapeHtmlText(input.link)}">${escapeHtmlText(input.link)}</a></p>`);
  return { title, content: parts.join("\n") };
}

type BloggerReply = { id?: string; url?: string; error?: { status?: string; message?: string } };

/** Map a Blogger API error to a short, safe explanation. The raw provider message is never forwarded. */
function bloggerErrorText(j: BloggerReply, status: number): string {
  if (status === 401) return "Google rejected the Blogger access token (expired or revoked). Reconnect Blogger on the Social posts page, then try again.";
  if (status === 403) return "The Blogger connection is missing the publishing permission, or this Google account can't post to that blog. Reconnect Blogger and approve the Blogger permission.";
  if (status === 404) return "Google could not find that blog. Pick the blog again on the Social posts page, then try again.";
  return `Blogger returned an error (HTTP ${status}${j.error?.status ? `, ${j.error.status}` : ""}). Nothing was confirmed as posted; check the blog before retrying.`;
}

function bloggerNetError(e: unknown): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "Blogger didn't answer in time. Nothing was confirmed as posted; check the blog before retrying.";
  return "Couldn't reach Blogger. Nothing was confirmed as posted; check the blog before retrying.";
}

/** Blogger: one posts.insert with the user's OAuth token in the Authorization header (never in the URL). */
export async function publishToBlogger(
  setup: Extract<BloggerPublishSetup, { ready: true }>,
  input: SocialPostInput,
  f: Fetch = fetch,
): Promise<TargetResult> {
  try {
    const { title, content } = bloggerPostContent(input);
    const r = await f(`${BLOGGER_API_BASE}/blogs/${encodeURIComponent(setup.blogId)}/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setup.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "blogger#post", blog: { id: setup.blogId }, title, content }),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as BloggerReply;
    if (!r.ok || j.error) return { target: "blogger", ok: false, error: bloggerErrorText(j, r.status) };
    if (!j.id) return { target: "blogger", ok: false, error: "Blogger answered without a post id. Check the blog before retrying." };
    return { target: "blogger", ok: true, id: j.id, url: j.url };
  } catch (e) {
    return { target: "blogger", ok: false, error: bloggerNetError(e) };
  }
}

/** Validate the shared post input once, before any network call. Returns a plain error string or null. */
export function postInputProblem(input: SocialPostInput, targets: SocialTarget[]): string | null {
  if (!targets.length) return "Pick at least one place to post.";
  if (!input.message?.trim()) return "Write the post text first.";
  if (input.message.length > SOCIAL_MESSAGE_MAX) return `Keep the post under ${SOCIAL_MESSAGE_MAX} characters.`;
  if (input.title && input.title.trim().length > SOCIAL_TITLE_MAX) return `Keep the blog title under ${SOCIAL_TITLE_MAX} characters.`;
  if (input.link && !isHttpsUrl(input.link)) return "The link must be a full https URL.";
  if (input.imageUrl && !isHttpsUrl(input.imageUrl)) return "The image URL must be a full https URL.";
  if (targets.includes("instagram") && !input.imageUrl) return "Instagram needs a public image URL — it has no text-only posts. Add an image URL or untick Instagram.";
  return null;
}

/**
 * Publish to each selected target in order; one target failing never blocks the others. The Blogger
 * setup is resolved by the caller (per user, via socialBlogger.ts) and passed in; without it, a Blogger
 * target fails gracefully with a connect prompt and no network call is made.
 */
export async function publishSocialPost(
  cfg: MetaConfig,
  input: SocialPostInput,
  targets: SocialTarget[],
  f: Fetch = fetch,
  blogger?: BloggerPublishSetup,
): Promise<TargetResult[]> {
  const ready = targetReadiness(cfg);
  const out: TargetResult[] = [];
  for (const t of targets) {
    if (t === "blogger") {
      out.push(blogger?.ready
        ? await publishToBlogger(blogger, input, f)
        : { target: "blogger", ok: false, error: blogger?.reason ?? "Blogger is not connected. Connect it on the Social posts page, then try again." });
    } else if (!ready[t].ready) {
      out.push({ target: t, ok: false, error: `Not set up yet: ${ready[t].reason}. Add the missing server env vars, then try again.` });
    } else if (t === "facebook") {
      out.push(await publishToFacebook(cfg, input, f));
    } else {
      out.push(await publishToInstagram(cfg, input, f));
    }
  }
  return out;
}
