import { SOCIAL_TOPIC_MAX } from "@/lib/socialConfig";
import { bloggerReadiness } from "@/lib/server/socialBlogger";
import { loadSocialWriterKey } from "@/lib/server/socialKeys";
import { generateBlogPost } from "@/lib/server/socialDraft";
import { createScheduledPost } from "@/lib/server/socialSchedule";

/**
 * Blogger autopilot (migration 0026): TARGET posts to the user's own Blogger blog on its own, on the
 * social cron's cadence (every 4 hours). The user turns it on once on /app/social and saves the topic
 * the posts should be about; everything else is assembled from what they already set up — the blog
 * choice lives in social_blogger_settings (0025, read through bloggerReadiness), the AI key that
 * writes the posts is their sealed row in social_ai_keys (0023/0027, via loadSocialWriterKey —
 * NVIDIA preferred, Gemini fallback), and the post itself is an ordinary row in the scheduled-posts
 * queue (0024) targeting only Blogger and due immediately, so the same cron run's publisher sends it
 * with the user's own OAuth setup and the exactly-once claim applies unchanged. This module holds
 * only the settings row and the generation step; it never publishes anything itself and never sees
 * a Blogger token.
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

export type AutopilotFailure = { userId: string; error: string };

/**
 * The cron's generation step, run BEFORE the queue drain: for every user with autopilot on, write ONE
 * blog post about their saved topic with their own writer key and queue it as a Blogger-only post due
 * now. Setup gaps are skipped quietly (no topic, Blogger not connected or no blog chosen —
 * bloggerReadiness covers both, plus the server env — or a Blogger post still queued), but a user who
 * IS set up and still can't get a post written is NOT silent: no writer key saved, or the provider
 * rejecting/failing the call, lands in `failures` with the plain reason, which the cron route returns
 * in its response and records with the run — a rejected key must never again look like "generated: 0"
 * with no explanation (that is exactly how the dead Gemini key hid). One user's failure never stops
 * the others or the drain that follows. Returns how many posts were generated, plus the failures.
 */
export async function runBloggerAutopilot(db: Db, deps: AutopilotDeps = {}): Promise<{ generated: number; failures: AutopilotFailure[] }> {
  const f = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  let rows: { user_id: string; topic: string | null }[];
  try {
    const { data, error } = await db.from(SETTINGS_TABLE).select("user_id, topic").eq("enabled", true).limit(200);
    if (error || !data) return { generated: 0, failures: [] };
    rows = data as { user_id: string; topic: string | null }[];
  } catch {
    return { generated: 0, failures: [] };
  }
  let generated = 0;
  const failures: AutopilotFailure[] = [];
  for (const row of rows) {
    const userId = String(row.user_id);
    try {
      const topic = String(row.topic ?? "").trim();
      if (!topic) continue;
      if (!(await bloggerReadiness(db, userId, env)).ready) continue;
      if (await hasQueuedBloggerPost(db, userId)) continue;
      const key = await loadSocialWriterKey(db, userId);
      if (!key) {
        failures.push({ userId, error: "No AI API key is saved for this user, so the post couldn't be written. Add an NVIDIA (or Gemini) key on the Connectors page." });
        continue;
      }
      const post = await generateBlogPost({ provider: key.provider, apiKey: key.apiKey, model: key.model, topic }, f);
      if (!post.ok) {
        failures.push({ userId, error: post.error });
        continue;
      }
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
      failures.push({ userId, error: "The autopilot generation step failed unexpectedly for this user." });
    }
  }
  return { generated, failures };
}
