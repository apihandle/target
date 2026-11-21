import { SOCIAL_TOPIC_MAX } from "@/lib/socialConfig";
import { bloggerReadiness } from "@/lib/server/socialBlogger";
import { loadGeminiKey } from "@/lib/server/socialKeys";
import { generateBlogPost } from "@/lib/server/socialDraft";
import { createScheduledPost } from "@/lib/server/socialSchedule";

/**
 * Blogger autopilot (migration 0026): TARGET posts to the user's own Blogger blog on its own, on the
 * social cron's cadence (every 4 hours). The user turns it on once on /app/social and saves the topic
 * the posts should be about; everything else is assembled from what they already set up — the blog
 * choice lives in social_blogger_settings (0025, read through bloggerReadiness), the Gemini key that
 * writes the posts is their sealed row in social_ai_keys (0023, via loadGeminiKey), and the post
 * itself is an ordinary row in the scheduled-posts queue (0024) targeting only Blogger and due
 * immediately, so the same cron run's publisher sends it with the user's own OAuth setup and the
 * exactly-once claim applies unchanged. This module holds only the settings row and the generation
 * step; it never publishes anything itself and never sees a Blogger token.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
type Env = Record<string, string | undefined>;

const SETTINGS_TABLE = "social_autopilot_settings";
const QUEUE_TABLE = "social_scheduled_posts";

export type AutopilotSettings = { enabled: boolean; topic: string };

export const AUTOPILOT_OFF: AutopilotSettings = { enabled: false, topic: "" };

/** The caller's autopilot settings; the off default when no row exists yet (or the table is unreachable). */
export async function autopilotSettings(db: Db, userId: string): Promise<AutopilotSettings> {
  try {
    const { data, error } = await db.from(SETTINGS_TABLE).select("enabled, topic").eq("user_id", userId).maybeSingle();
    if (error || !data) return { ...AUTOPILOT_OFF };
    return { enabled: data.enabled === true, topic: String(data.topic ?? "") };
  } catch {
    return { ...AUTOPILOT_OFF };
  }
}

/** Validate a settings save once, before any row is written. Returns a plain error string or null. */
export function autopilotProblem(input: AutopilotSettings): string | null {
  const topic = input.topic.trim();
  if (topic.length > SOCIAL_TOPIC_MAX) return `Keep the topic under ${SOCIAL_TOPIC_MAX} characters.`;
  if (input.enabled && !topic) return "Write the topic your blog posts should be about first — autopilot needs a subject to write on.";
  return null;
}

/** Save/replace the caller's autopilot settings (one row per user). */
export async function saveAutopilotSettings(db: Db, userId: string, input: AutopilotSettings): Promise<AutopilotSettings> {
  const clean: AutopilotSettings = { enabled: input.enabled === true, topic: input.topic.trim().slice(0, SOCIAL_TOPIC_MAX) };
  const { error } = await db.from(SETTINGS_TABLE).upsert(
    { user_id: userId, enabled: clean.enabled, topic: clean.topic || null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("Could not save the autopilot settings");
  return clean;
}

/**
 * True while one of the user's Blogger posts is still waiting to go out (pending or mid-publish).
 * Autopilot never stacks a second generated post on top of one that hasn't published yet — whatever
 * kept the first one waiting (a full cron batch, a slow run) gets a chance to clear first.
 */
async function hasQueuedBloggerPost(db: Db, userId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from(QUEUE_TABLE)
      .select("id, targets").eq("user_id", userId).in("status", ["pending", "publishing"]).limit(50);
    if (error || !data) return false;
    return (data as { targets?: unknown }[]).some((r) => Array.isArray(r.targets) && r.targets.includes("blogger"));
  } catch {
    return false;
  }
}

type AutopilotDeps = { env?: Env; fetch?: typeof fetch; now?: Date };

/**
 * The cron's generation step, run BEFORE the queue drain: for every user with autopilot on, write ONE
 * blog post about their saved topic with their own Gemini key and queue it as a Blogger-only post due
 * now. A user is skipped quietly when any prerequisite is missing (no topic, Blogger not connected or
 * no blog chosen — bloggerReadiness covers both, plus the server env — or no Gemini key saved), when
 * one of their Blogger posts is still queued, or when generation fails; one user's failure never
 * stops the others or the drain that follows. Returns how many posts were generated.
 */
export async function runBloggerAutopilot(db: Db, deps: AutopilotDeps = {}): Promise<{ generated: number }> {
  const f = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  let rows: { user_id: string; topic: string | null }[];
  try {
    const { data, error } = await db.from(SETTINGS_TABLE).select("user_id, topic").eq("enabled", true).limit(200);
    if (error || !data) return { generated: 0 };
    rows = data as { user_id: string; topic: string | null }[];
  } catch {
    return { generated: 0 };
  }
  let generated = 0;
  for (const row of rows) {
    try {
      const userId = String(row.user_id);
      const topic = String(row.topic ?? "").trim();
      if (!topic) continue;
      if (!(await bloggerReadiness(db, userId, env)).ready) continue;
      const key = await loadGeminiKey(db, userId);
      if (!key) continue;
      if (await hasQueuedBloggerPost(db, userId)) continue;
      const post = await generateBlogPost({ apiKey: key.apiKey, model: key.model, topic }, f);
      if (!post.ok) continue;
      await createScheduledPost(db, userId, {
        message: post.body,
        title: post.title,
        targets: ["blogger"],
        autoGenerate: false,
        tone: "announcement",
        scheduledAt: now.toISOString(),
      });
      generated++;
    } catch {
      // Deliberately swallowed per user: the queue drain (and everyone else's autopilot) still runs.
    }
  }
  return { generated };
}
