import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { isSocialTarget, type SocialTarget } from "@/lib/socialConfig";
import { metaConfig, postInputProblem, publishSocialPost, type SocialPostInput } from "@/lib/server/socialPost";
import { resolveBloggerSetup } from "@/lib/server/socialBlogger";
import { resolveMetaSetup } from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Publish one post to the selected targets (TARGET's Facebook Page and/or its Instagram account, and/or
 * the caller's chosen Blogger blog). Standard admin write: confirm: true, audit entry first (message
 * length + targets only — never a token), a failed: true entry when nothing could be posted. 200 when
 * at least one target published; 502 when every selected target failed, with per-target results in both.
 */
export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const targets = Array.from(new Set((Array.isArray(c.body.targets) ? c.body.targets : []).filter(isSocialTarget))) as SocialTarget[];
  const input: SocialPostInput = {
    message: typeof c.body.message === "string" ? c.body.message.trim() : "",
    link: typeof c.body.link === "string" && c.body.link.trim() ? c.body.link.trim() : undefined,
    imageUrl: typeof c.body.imageUrl === "string" && c.body.imageUrl.trim() ? c.body.imageUrl.trim() : undefined,
    title: typeof c.body.title === "string" && c.body.title.trim() ? c.body.title.trim() : undefined,
  };
  const problem = postInputProblem(input, targets);
  if (problem) return json({ error: problem }, 400);

  const entry = {
    action: "social.publish",
    targetType: "social_post",
    targetId: targets.join("+"),
    detail: { targets, chars: input.message.length, hasImage: !!input.imageUrl, hasLink: !!input.link, hasTitle: !!input.title },
  };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;

  const blogger = targets.includes("blogger") ? await resolveBloggerSetup(a.db, a.user.id) : undefined;
  // The admin's own connected Page wins when they picked one; otherwise the env owner config (v1).
  const metaSetup = targets.some((t) => t !== "blogger") ? await resolveMetaSetup(a.user.id) : null;
  const cfg = metaSetup?.ready ? metaSetup.cfg : metaConfig();
  const results = await publishSocialPost(cfg, input, targets, fetch, blogger);
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    await auditFailure(a.db, a, entry, results.map((r) => (r.ok ? "" : `${r.target}: ${r.error}`)).filter(Boolean).join(" · ").slice(0, 200) || "all targets failed");
    return json({ results }, 502);
  }
  return json({ results });
}
