import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { META_ENV_VARS } from "@/lib/socialConfig";
import { metaConfig, targetReadiness } from "@/lib/server/socialPost";
import { geminiKeyStatus } from "@/lib/server/socialKeys";
import { bloggerReadiness, bloggerStatus } from "@/lib/server/socialBlogger";
import { resolveMetaSetup } from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";

/**
 * Social posting setup status: which Meta env vars are set (names only, never values — same rule as
 * /admin/health), the configured Page / Instagram ids (configuration, not secrets), per-target readiness
 * (Blogger's is per-user: OAuth client env + the caller's connection + chosen blog), the caller's Blogger
 * block, and the caller's stored Gemini key state (masked preview only).
 */
export async function GET() {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const envCfg = metaConfig();
  // Readiness follows what publishing would actually use: the admin's own picked Page when their
  // Meta setup is ready, else the env owner config (the setup panel below still reports the env).
  const metaSetup = await resolveMetaSetup(a.user.id);
  const cfg = metaSetup.ready ? metaSetup.cfg : envCfg;
  const gemini = await geminiKeyStatus(a.db, a.user.id);
  const blogger = await bloggerStatus(a.db, a.user.id);
  const bloggerReady = await bloggerReadiness(a.db, a.user.id);
  return json({
    meta: {
      vars: META_ENV_VARS.map((name) => ({ name, set: !!process.env[name]?.trim() })),
      pageId: envCfg.pageId || null,
      igUserId: envCfg.igUserId || null,
      graphVersion: envCfg.graphVersion,
    },
    targets: { ...targetReadiness(cfg), blogger: bloggerReady },
    gemini,
    blogger,
  });
}
