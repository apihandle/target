import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { isDraftTone, isSocialTarget, type SocialTarget } from "@/lib/socialConfig";
import {
  cancelScheduledPost, createScheduledPost, listScheduledPosts, scheduledPostProblem, type ScheduledPostInput,
} from "@/lib/server/socialSchedule";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The scheduled-post queue for /admin/social (migration 0024). GET lists the caller's own queue; POST
 * schedules a post (finished text, or a Gemini brief with autoGenerate: true — the text is then written
 * at publish time with the caller's stored key); DELETE cancels a still-pending post. Writes follow the
 * standard admin pattern: confirm: true + an audit entry first, whose detail carries only targets, time
 * and lengths — never post text beyond its length, and never any key or token.
 */
export async function GET() {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  return json({ posts: await listScheduledPosts(a.db, a.user.id) });
}

export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const input: ScheduledPostInput = {
    message: typeof c.body.message === "string" ? c.body.message.trim() : "",
    link: typeof c.body.link === "string" && c.body.link.trim() ? c.body.link.trim() : undefined,
    imageUrl: typeof c.body.imageUrl === "string" && c.body.imageUrl.trim() ? c.body.imageUrl.trim() : undefined,
    title: typeof c.body.title === "string" && c.body.title.trim() ? c.body.title.trim() : undefined,
    targets: Array.from(new Set((Array.isArray(c.body.targets) ? c.body.targets : []).filter(isSocialTarget))) as SocialTarget[],
    autoGenerate: c.body.autoGenerate === true,
    topic: typeof c.body.topic === "string" ? c.body.topic.trim() : undefined,
    tone: isDraftTone(c.body.tone) ? c.body.tone : "announcement",
    scheduledAt: typeof c.body.scheduledAt === "string" ? c.body.scheduledAt : "",
  };
  const problem = scheduledPostProblem(input, new Date());
  if (problem) return json({ error: problem }, 400);

  const entry = {
    action: "social.schedule.create",
    targetType: "social_scheduled_post",
    targetId: input.targets.join("+"),
    detail: {
      targets: input.targets, at: new Date(input.scheduledAt).toISOString(), autoGenerate: input.autoGenerate,
      chars: input.message.length, topicChars: input.topic?.length ?? 0, hasImage: !!input.imageUrl, hasLink: !!input.link, hasTitle: !!input.title,
    },
  };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    const post = await createScheduledPost(a.db, a.user.id, input);
    return json({ post });
  } catch {
    await auditFailure(a.db, a, entry, "insert failed");
    return json({ error: "Could not schedule the post. If this keeps happening, migrations 0024/0025 may not have run yet." }, 500);
  }
}

export async function DELETE(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const id = typeof c.body.id === "string" ? c.body.id : "";
  if (!id) return json({ error: "Missing scheduled post id." }, 400);
  const entry = { action: "social.schedule.cancel", targetType: "social_scheduled_post", targetId: id, detail: {} };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const done = await cancelScheduledPost(a.db, a.user.id, id);
  if (!done) {
    await auditFailure(a.db, a, entry, "not pending");
    return json({ error: "That post is no longer pending — it may already have been published or cancelled." }, 400);
  }
  return json({ posts: await listScheduledPosts(a.db, a.user.id) });
}
