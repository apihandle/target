import {
  isHttpsUrl, isSocialTarget, SOCIAL_MESSAGE_MAX, SOCIAL_TITLE_MAX, SOCIAL_TOPIC_MAX,
  type DraftTone, type ScheduledPostStatus, type SocialTarget,
} from "@/lib/socialConfig";
import { metaConfig, postInputProblem, publishSocialPost, type BloggerPublishSetup, type SocialPostInput, type TargetResult } from "@/lib/server/socialPost";
import { loadGeminiKey } from "@/lib/server/socialKeys";
import { generateSocialDraft } from "@/lib/server/socialDraft";
import { resolveBloggerSetup } from "@/lib/server/socialBlogger";
import { resolveMetaSetup, type MetaPublishSetup } from "@/lib/server/socialMeta";
import { isAdminUser } from "@/lib/server/adminCheck";
import type { User } from "@supabase/supabase-js";

/**
 * Scheduled social posts (migration 0024; Blogger target + title column added by 0025): the queue +
 * runner behind "post on schedule" for /admin/social. The admin API creates/cancels rows; the cron route
 * (/api/cron/social) calls runDueScheduledPosts with the service-role client. Publishing reuses
 * lib/server/socialPost.ts, and AI text at publish time reuses the owner's stored Gemini key
 * (lib/server/socialKeys.ts + socialDraft.ts) — the same flows as the manual composer, so every safety
 * property carries over: provider errors are pre-mapped to safe text, and no token or API key is ever
 * written to a row, a result or an error string. A Blogger target resolves the *owner's* OAuth setup at
 * publish time (lib/server/socialBlogger.ts) — the claim happens before that, so the exactly-once
 * guarantee is unchanged.
 *
 * Idempotency: a due post is claimed with an atomic compare-and-swap (status pending -> publishing,
 * guarded on the row's scheduled_at, the same shape as claimJob in scheduledRun.ts). Two runners firing
 * at once can both *see* the row, but only one claim succeeds; the other reports it skipped. A row left
 * in "publishing" by a runner that died mid-publish is never silently re-posted (it may have gone out):
 * the next run marks it failed with an explicit "check the accounts" error instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const TABLE = "social_scheduled_posts";
export const SCHEDULED_POST_COLS =
  "id, user_id, message, link, image_url, title, targets, auto_generate, topic, tone, scheduled_at, status, results, error, attempts, published_at, created_at, updated_at";

/** A post stuck in "publishing" longer than this is treated as interrupted, never re-posted. */
export const STALE_PUBLISHING_MS = 15 * 60_000;

export type ScheduledPostRow = {
  id: string;
  user_id: string;
  message: string;
  link: string | null;
  image_url: string | null;
  title: string | null;
  targets: string[];
  auto_generate: boolean;
  topic: string | null;
  tone: string | null;
  scheduled_at: string;
  status: ScheduledPostStatus;
  results: TargetResult[] | null;
  error: string | null;
  attempts: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What the admin API returns: camelCase, and safe by construction (the table holds no secrets). */
export type ScheduledPostView = {
  id: string;
  message: string;
  link: string | null;
  imageUrl: string | null;
  title: string | null;
  targets: SocialTarget[];
  autoGenerate: boolean;
  topic: string | null;
  tone: DraftTone;
  scheduledAt: string;
  status: ScheduledPostStatus;
  results: TargetResult[] | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  createdAt: string;
};

export function scheduledPostView(r: ScheduledPostRow): ScheduledPostView {
  return {
    id: r.id,
    message: r.message,
    link: r.link,
    imageUrl: r.image_url,
    title: r.title ?? null,
    targets: (r.targets ?? []).filter(isSocialTarget),
    autoGenerate: r.auto_generate === true,
    topic: r.topic,
    tone: r.tone === "tip" || r.tone === "question" ? r.tone : "announcement",
    scheduledAt: r.scheduled_at,
    status: r.status,
    results: r.results,
    error: r.error,
    attempts: r.attempts ?? 0,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

export type ScheduledPostInput = {
  message: string;
  link?: string;
  imageUrl?: string;
  title?: string;
  targets: SocialTarget[];
  autoGenerate: boolean;
  topic?: string;
  tone: DraftTone;
  scheduledAt: string;
};

/** Validate a schedule request once, before any row is written. Returns a plain error string or null. */
export function scheduledPostProblem(input: ScheduledPostInput, now: Date): string | null {
  if (!input.targets.length) return "Pick at least one place to post.";
  const at = new Date(input.scheduledAt);
  if (Number.isNaN(at.getTime())) return "Pick a valid date and time for the post.";
  if (at.getTime() <= now.getTime()) return "Pick a time in the future — or use Publish now for an immediate post.";
  if (input.link && !isHttpsUrl(input.link)) return "The link must be a full https URL.";
  if (input.imageUrl && !isHttpsUrl(input.imageUrl)) return "The image URL must be a full https URL.";
  if (input.title && input.title.trim().length > SOCIAL_TITLE_MAX) return `Keep the blog title under ${SOCIAL_TITLE_MAX} characters.`;
  if (input.targets.includes("instagram") && !input.imageUrl) return "Instagram needs a public image URL — it has no text-only posts. Add an image URL or untick Instagram.";
  if (input.autoGenerate) {
    if (!input.topic?.trim()) return "Write the topic/brief Gemini should write from, or turn off AI generation.";
    if (input.topic.length > SOCIAL_TOPIC_MAX) return `Keep the brief under ${SOCIAL_TOPIC_MAX} characters.`;
    return null;
  }
  if (input.message.length > SOCIAL_MESSAGE_MAX) return `Keep the post under ${SOCIAL_MESSAGE_MAX} characters.`;
  return postInputProblem({ message: input.message, link: input.link, imageUrl: input.imageUrl }, input.targets);
}

/** Insert one pending row for the owner. Input must already pass scheduledPostProblem. */
export async function createScheduledPost(db: Db, userId: string, input: ScheduledPostInput): Promise<ScheduledPostView> {
  const { data, error } = await db.from(TABLE).insert({
    user_id: userId,
    message: input.autoGenerate ? input.message.trim().slice(0, SOCIAL_MESSAGE_MAX) : input.message.trim(),
    link: input.link ?? null,
    image_url: input.imageUrl ?? null,
    title: input.title?.trim() ? input.title.trim().slice(0, SOCIAL_TITLE_MAX) : null,
    targets: input.targets,
    auto_generate: input.autoGenerate,
    topic: input.autoGenerate ? (input.topic ?? "").trim() : null,
    tone: input.autoGenerate ? input.tone : null,
    scheduled_at: new Date(input.scheduledAt).toISOString(),
    status: "pending",
  }).select(SCHEDULED_POST_COLS).single();
  if (error || !data) throw new Error("Could not schedule the post");
  return scheduledPostView(data as ScheduledPostRow);
}

/** The owner's queue for the composer: upcoming pending posts first (soonest first), then recent history. */
export async function listScheduledPosts(db: Db, userId: string): Promise<ScheduledPostView[]> {
  const { data, error } = await db.from(TABLE).select(SCHEDULED_POST_COLS).eq("user_id", userId).limit(100);
  if (error || !data) return [];
  const rows = (data as ScheduledPostRow[]).map(scheduledPostView);
  const pending = rows.filter((r) => r.status === "pending" || r.status === "publishing")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const done = rows.filter((r) => r.status !== "pending" && r.status !== "publishing")
    .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  return [...pending, ...done];
}

/** Cancel a still-pending post. Returns false when it already ran, was cancelled, or isn't the owner's. */
export async function cancelScheduledPost(db: Db, userId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from(TABLE)
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).eq("status", "pending")
    .select("id");
  return !error && !!data?.length;
}

/**
 * Claim one due post atomically: pending -> publishing only if nobody else moved it first (the update is
 * guarded on the status and the scheduled_at the caller read, like claimJob). False = another runner won.
 */
export async function claimScheduledPost(db: Db, post: Pick<ScheduledPostRow, "id" | "scheduled_at" | "attempts">, now: Date): Promise<boolean> {
  const { data, error } = await db.from(TABLE)
    .update({ status: "publishing", attempts: (post.attempts ?? 0) + 1, updated_at: now.toISOString() })
    .eq("id", post.id).eq("status", "pending").eq("scheduled_at", post.scheduled_at)
    .select("id");
  return !error && !!data?.length;
}

type RunDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Resolve the Blogger publish setup for a post's owner (defaults to the real connection store). */
  bloggerFor?: (userId: string) => Promise<BloggerPublishSetup>;
  /** Resolve the Meta publish setup for a post's owner (defaults to their own connection, env fallback for the owner). */
  metaFor?: (userId: string) => Promise<MetaPublishSetup>;
};

/**
 * Whether this user id belongs to a site admin, via the service-role auth API. Null when the client
 * can't answer (unit-test fakes, local dev) — callers treat null as "can't tell", not as "no".
 */
async function isAdminUserId(db: Db, userId: string, env?: Record<string, string | undefined>): Promise<boolean | null> {
  const admin = (db as { auth?: { admin?: { getUserById?: unknown } } }).auth?.admin;
  if (!admin || typeof admin.getUserById !== "function") return null;
  try {
    const { data } = await (admin.getUserById as (id: string) => Promise<{ data: { user: User | null } }>)(userId);
    return data?.user ? isAdminUser(data.user, env) : false;
  } catch {
    return null;
  }
}

async function finishPost(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  // Guarded on "publishing": only the runner that claimed the row may write its outcome.
  await db.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "publishing");
}

const failWith = (error: string) => ({ status: "failed" as const, error: error.slice(0, 500), results: null });

/**
 * Publish one already-claimed post. When auto_generate is set, the text is written first by Gemini with
 * the owner's stored key and the generated text is saved back onto the row (so the queue shows what went
 * out). At least one target published => "published" (per-target detail lives in results, same rule as
 * the manual publish route); every target failed => "failed" with the mapped, safe error text.
 */
export async function runScheduledPost(
  db: Db,
  post: ScheduledPostRow,
  deps: RunDeps = {},
): Promise<{ id: string; status: "published" | "failed" }> {
  const f = deps.fetch ?? fetch;
  try {
    let message = post.message;
    if (post.auto_generate) {
      const key = await loadGeminiKey(db, post.user_id);
      if (!key) {
        await finishPost(db, post.id, failWith("No Gemini key is saved for this post's owner, so the text couldn't be written. Add the key on the Social posts page, then schedule again."));
        return { id: post.id, status: "failed" };
      }
      const draft = await generateSocialDraft(
        { apiKey: key.apiKey, model: key.model, topic: post.topic ?? "", tone: post.tone === "tip" || post.tone === "question" ? post.tone : "announcement" },
        f,
      );
      if (!draft.ok) {
        await finishPost(db, post.id, failWith(draft.error));
        return { id: post.id, status: "failed" };
      }
      message = draft.text;
    }
    const targets = (post.targets ?? []).filter(isSocialTarget);
    const input: SocialPostInput = {
      message,
      link: post.link ?? undefined,
      imageUrl: post.image_url ?? undefined,
      title: post.title ?? undefined,
    };
    const problem = postInputProblem(input, targets);
    if (problem) {
      await finishPost(db, post.id, { ...failWith(problem), message });
      return { id: post.id, status: "failed" };
    }
    // Blogger is per-user OAuth, not env config: resolve the owner's setup only when the post targets it.
    const blogger = targets.includes("blogger")
      ? await (deps.bloggerFor ?? ((userId: string) => resolveBloggerSetup(db, userId, f, deps.env)))(post.user_id)
      : undefined;
    // Meta is per-user too (phase 2): the post publishes with the POSTING user's own connection —
    // their picked Page and its token, never another user's. The env owner config remains the
    // fallback for the owner's own posts only: when the resolved setup comes from env and the
    // poster is a confirmed non-admin (e.g. they disconnected Meta after scheduling), the Meta
    // targets fail with the reason instead of landing on the owner's Page.
    const metaTargets = targets.filter((t) => t !== "blogger");
    let metaCfg = metaConfig(deps.env);
    let metaFailure: string | null = null;
    if (metaTargets.length) {
      const setup = await (deps.metaFor ?? ((userId: string) => resolveMetaSetup(userId, deps.env)))(post.user_id);
      if (!setup.ready) metaFailure = setup.reason;
      else if (setup.source === "env" && (await isAdminUserId(db, post.user_id, deps.env)) === false) {
        metaFailure = "The post's owner has no Meta account connected, so there is no Page of theirs to post to. (The site owner's Page is only used for the owner's own posts.)";
      } else metaCfg = setup.cfg;
    }
    let results: TargetResult[];
    if (metaFailure === null) {
      results = await publishSocialPost(metaCfg, input, targets, f, blogger);
    } else if (targets.includes("blogger")) {
      // A Blogger target still publishes on its own; the Meta results are spliced back in order.
      const bResults = await publishSocialPost(metaCfg, input, ["blogger"], f, blogger);
      results = targets.map((t) => (t === "blogger" ? bResults[0] : { target: t, ok: false as const, error: metaFailure! }));
    } else {
      results = metaTargets.map((t) => ({ target: t, ok: false as const, error: metaFailure! }));
    }
    const okCount = results.filter((r) => r.ok).length;
    if (okCount === 0) {
      const why = results.map((r) => (r.ok ? "" : `${r.target}: ${r.error}`)).filter(Boolean).join(" · ");
      await finishPost(db, post.id, { ...failWith(why || "Every target failed."), results, message });
      return { id: post.id, status: "failed" };
    }
    await finishPost(db, post.id, { status: "published", results, error: null, message, published_at: new Date().toISOString() });
    return { id: post.id, status: "published" };
  } catch (e) {
    // publishSocialPost / generateSocialDraft already map provider errors; anything reaching here is
    // unexpected, so the row gets a generic line and the detail stays in the server log only.
    console.error("[social-cron] scheduled post failed:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    await finishPost(db, post.id, failWith("The scheduled post failed unexpectedly. Nothing was confirmed as posted; check the accounts before reposting."));
    return { id: post.id, status: "failed" };
  }
}

/**
 * One cron pass: fail stale "publishing" rows (interrupted runs), then claim and publish due pending
 * posts, soonest first, up to `batch`. Returns one entry per due post seen, including "skipped" for a
 * post another runner claimed first — so a double fire is visible, and never a double post.
 */
export async function runDueScheduledPosts(
  db: Db,
  deps: RunDeps & { now?: Date; batch?: number } = {},
): Promise<{ ran: number; results: { id: string; status: string }[] }> {
  const now = deps.now ?? new Date();
  const batch = deps.batch ?? 3;

  const staleBefore = new Date(now.getTime() - STALE_PUBLISHING_MS).toISOString();
  const { data: stale } = await db.from(TABLE).select("id").eq("status", "publishing").lt("updated_at", staleBefore).limit(20);
  for (const row of (stale ?? []) as { id: string }[]) {
    await db.from(TABLE)
      .update({ status: "failed", error: "Publishing was interrupted before the result was recorded. The post may or may not have gone out — check the accounts before reposting.", updated_at: now.toISOString() })
      .eq("id", row.id).eq("status", "publishing");
  }

  const { data, error } = await db.from(TABLE)
    .select(SCHEDULED_POST_COLS)
    .eq("status", "pending").lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true }).limit(50);
  if (error || !data) return { ran: 0, results: [] };
  const due = (data as ScheduledPostRow[])
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, batch);

  const results: { id: string; status: string }[] = [];
  for (const post of due) {
    if (!(await claimScheduledPost(db, post, now))) { results.push({ id: post.id, status: "skipped" }); continue; }
    results.push(await runScheduledPost(db, post, deps));
  }
  return { ran: results.filter((r) => r.status !== "skipped").length, results };
}
