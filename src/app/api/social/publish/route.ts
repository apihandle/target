import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isAdminUser } from "@/lib/server/adminCheck";
import { isSocialTarget, type SocialTarget } from "@/lib/socialConfig";
import { metaConfig, postInputProblem, publishSocialPost, type MetaConfig, type SocialPostInput } from "@/lib/server/socialPost";
import { resolveBloggerSetup } from "@/lib/server/socialBlogger";
import { userMetaConfig } from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Publish one post from the /app/social composer — the user-level twin of /api/admin/social/publish.
 * Destinations are the caller's OWN accounts only: Meta targets resolve through the caller's own
 * Meta connection (their picked Page + its Instagram), Blogger through their own Blogger connection.
 * The env-configured owner Page remains available as a fallback to the site owner (admin) only —
 * a regular user with no Meta connection of their own gets a connect-first error, never a post on
 * someone else's Page. 200 when at least one target published; 502 when every target failed.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const targets = Array.from(new Set((Array.isArray(body.targets) ? body.targets : []).filter(isSocialTarget))) as SocialTarget[];
  const input: SocialPostInput = {
    message: typeof body.message === "string" ? body.message.trim() : "",
    link: typeof body.link === "string" && body.link.trim() ? body.link.trim() : undefined,
    imageUrl: typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : undefined,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
  };
  const problem = postInputProblem(input, targets);
  if (problem) return json({ error: problem }, 400);

  // Blogger-only posts never touch Meta config; the publisher ignores it for the blogger target.
  let cfg: MetaConfig = metaConfig();
  if (targets.some((t) => t !== "blogger")) {
    const mc = await userMetaConfig(a.user.id, isAdminUser(a.user));
    if (!mc.ok) return json({ error: mc.error }, 400);
    cfg = mc.cfg;
  }

  const blogger = targets.includes("blogger") ? await resolveBloggerSetup(a.db, a.user.id) : undefined;
  const results = await publishSocialPost(cfg, input, targets, fetch, blogger);
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) return json({ results }, 502);
  return json({ results });
}
