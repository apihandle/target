import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { isAdminUser } from "@/lib/server/adminCheck";
import { isDraftTone, isSocialTarget, type SocialTarget } from "@/lib/socialConfig";
import {
  cancelScheduledPost, createScheduledPost, listScheduledPosts, scheduledPostProblem, type ScheduledPostInput,
} from "@/lib/server/socialSchedule";
import { userMetaConfig } from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The scheduled-post queue for the /app/social composer — the user-level twin of
 * /api/admin/social/schedule (migration 0024). GET lists the caller's own queue; POST schedules a
 * post (finished text, or a Gemini brief with autoGenerate: true — written at publish time with the
 * caller's stored key); DELETE cancels a still-pending post. Meta targets are accepted only when
 * the caller could publish to them right now with their OWN connection (userMetaConfig) — the cron
 * runner re-resolves the posting user's connections at publish time, and the env owner config
 * remains the owner's fallback, never a regular user's route onto the owner's Page. Writes go
 * through the service-role client (migration 0024 grants `authenticated` SELECT/DELETE only);
 * every query is scoped to the caller's own user id inside socialSchedule.ts.
 */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  return json({ posts: await listScheduledPosts(serviceDb(a.db), a.user.id) });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const input: ScheduledPostInput = {
    message: typeof body.message === "string" ? body.message.trim() : "",
    link: typeof body.link === "string" && body.link.trim() ? body.link.trim() : undefined,
    imageUrl: typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : undefined,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
    targets: Array.from(new Set((Array.isArray(body.targets) ? body.targets : []).filter(isSocialTarget))) as SocialTarget[],
    autoGenerate: body.autoGenerate === true,
    topic: typeof body.topic === "string" ? body.topic.trim() : undefined,
    tone: isDraftTone(body.tone) ? body.tone : "announcement",
    scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : "",
  };
  const problem = scheduledPostProblem(input, new Date());
  if (problem) return json({ error: problem }, 400);
  if (input.targets.some((t) => t !== "blogger")) {
    const mc = await userMetaConfig(a.user.id, isAdminUser(a.user));
    if (!mc.ok) return json({ error: mc.error }, 400);
  }
  try {
    const post = await createScheduledPost(serviceDb(a.db), a.user.id, input);
    return json({ post });
  } catch {
    return json({ error: "Could not schedule the post. If this keeps happening, migrations 0024/0025 may not have run yet." }, 500);
  }
}

export async function DELETE(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return json({ error: "Missing scheduled post id." }, 400);
  const db = serviceDb(a.db);
  const done = await cancelScheduledPost(db, a.user.id, id);
  if (!done) return json({ error: "That post is no longer pending — it may already have been published or cancelled." }, 400);
  return json({ posts: await listScheduledPosts(db, a.user.id) });
}
