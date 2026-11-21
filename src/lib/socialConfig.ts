/**
 * Social posting (AlphaPost-style "write once, post everywhere" for TARGET's own accounts): pure definitions
 * shared by the server, the /admin UI and tests — env var names, limits, target definitions, draft tones.
 * No server imports here. Design: ~/workspace/target-social-posting/DESIGN.md.
 *
 * Two kinds of secret, on purpose:
 *  - Meta: since phase 2 every user connects their OWN Facebook account (Facebook Login) and picks
 *    their Page; the tokens are sealed per user in `connections` under the provider id "meta"
 *    (see lib/server/socialMeta.ts). The env vars below remain as the site owner's configuration:
 *    META_APP_ID / META_APP_SECRET are the app the login flow runs under, and the Page id/token/IG
 *    id are the owner's fallback for the owner's own posts (v1 behaviour, admin only);
 *  - the Gemini API key is NOT an env var: it is the signed-in user's own key, pasted into the app and stored
 *    sealed per user, exactly like a custom provider key (see lib/server/socialKeys.ts).
 */

/** Meta env vars (server-side only). The token value is a secret; the ids are configuration. */
export const META_ENV_VARS = [
  "META_FACEBOOK_PAGE_ID",
  "META_FACEBOOK_PAGE_ACCESS_TOKEN",
  "META_INSTAGRAM_USER_ID",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_GRAPH_API_VERSION",
] as const;
export type MetaEnvVar = (typeof META_ENV_VARS)[number];

/** Env vars without which nothing can publish at all. */
export const META_REQUIRED_VARS: MetaEnvVar[] = ["META_FACEBOOK_PAGE_ID", "META_FACEBOOK_PAGE_ACCESS_TOKEN"];

/** Fallback Graph API version when META_GRAPH_API_VERSION is unset; set the env var to the app's version. */
export const DEFAULT_GRAPH_VERSION = "v21.0";

/**
 * Scopes the per-user Facebook Login flow asks for (phase 2: every user connects their own Page +
 * Instagram, lib/connectors/meta.ts). pages_show_list + pages_read_engagement list the user's Pages
 * and the Instagram account linked to a Page; pages_manage_posts and instagram_content_publish are
 * what the publisher needs; instagram_basic reads the IG account's username.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/** The Graph API version in effect (env override, else the conservative default). */
export const metaGraphVersion = (env: Record<string, string | undefined>): string =>
  (env.META_GRAPH_API_VERSION ?? "").trim() || DEFAULT_GRAPH_VERSION;

/** One caption limit for every target: Instagram's maximum. Facebook allows far more. */
export const SOCIAL_MESSAGE_MAX = 2200;
export const SOCIAL_TOPIC_MAX = 500;
/** Optional explicit title for the Blogger post (the first line of the text is used when empty). */
export const SOCIAL_TITLE_MAX = 200;

/** Gemini model used when the saved key has no model chosen. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
/** Gemini model ids look like "gemini-2.5-flash" (letters, numbers, dots, dashes). */
export const GEMINI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,99}$/;

/** A pasted API key, validated exactly like a custom provider key (lib/customProvider.ts providerInput). */
export const API_KEY_MAX = 500;
export function apiKeyProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "Enter the API key";
  const k = raw.trim();
  if (k.length > API_KEY_MAX) return "That key is too long";
  if (/\s/.test(k)) return "The API key can't contain spaces";
  return null;
}

/** The two Meta targets publish via the posting user's own Meta connection (env = owner fallback); Blogger is connected per user (Google OAuth). */
export type MetaTarget = "facebook" | "instagram";
export type SocialTarget = MetaTarget | "blogger";
export const SOCIAL_TARGETS: { id: SocialTarget; label: string; hint: string }[] = [
  { id: "facebook", label: "Facebook Page", hint: "Target - Your Personal AI" },
  { id: "instagram", label: "Instagram", hint: "@gettarget.app · needs a public image URL" },
  { id: "blogger", label: "Blogger", hint: "A post on your connected blog" },
];
export const isSocialTarget = (v: unknown): v is SocialTarget => v === "facebook" || v === "instagram" || v === "blogger";

/**
 * Blogger connect (migration 0025): unlike the Meta values, the Blogger token is NOT an env var — the
 * admin connects their own Google account inside TARGET (the "blogger" connector, lib/connectors/blogger.ts)
 * and the OAuth tokens are stored sealed in `connections`, exactly like every other provider secret. Only
 * the OAuth *client* is server configuration, and it is a separate Google Cloud client from the main
 * Google connector's: the Blogger consent asks for the Blogger scope alone, and its redirect URI is the
 * blogger connector's callback.
 */
export const BLOGGER_ENV_VARS = ["BLOGGER_OAUTH_CLIENT_ID", "BLOGGER_OAUTH_CLIENT_SECRET"] as const;
/** The one scope Blogger publishing needs (read the user's blogs + create posts). */
export const BLOGGER_SCOPE = "https://www.googleapis.com/auth/blogger";
export const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";

/** Scheduled-post lifecycle (migration 0024): pending → publishing → published | failed; pending → cancelled. */
export type ScheduledPostStatus = "pending" | "publishing" | "published" | "failed" | "cancelled";
export const SCHEDULED_POST_STATUSES: ScheduledPostStatus[] = ["pending", "publishing", "published", "failed", "cancelled"];
export const isScheduledPostStatus = (v: unknown): v is ScheduledPostStatus =>
  typeof v === "string" && (SCHEDULED_POST_STATUSES as string[]).includes(v);

export type DraftTone = "announcement" | "tip" | "question";
export const DRAFT_TONES: { id: DraftTone; label: string }[] = [
  { id: "announcement", label: "Announcement" },
  { id: "tip", label: "Helpful tip" },
  { id: "question", label: "Ask a question" },
];
export const isDraftTone = (v: unknown): v is DraftTone => v === "announcement" || v === "tip" || v === "question";

/** Escape text for inclusion in HTML (the Blogger body is HTML; the composed text is plain text). */
export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Plain text → simple HTML paragraphs for a Blogger post body: blank lines split paragraphs, single
 * newlines become <br>, and all text is escaped first. The one mapping used by the social publisher
 * (lib/server/socialPost.ts) and the Blogger connector's create_post tool.
 */
export function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtmlText(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** True for a syntactically valid https URL (Instagram media and photo posts can only fetch public https). */
export function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}
