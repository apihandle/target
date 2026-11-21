import { requireAdminPage } from "@/lib/server/adminAuth";
import { META_ENV_VARS } from "@/lib/socialConfig";
import { metaConfig, targetReadiness } from "@/lib/server/socialPost";
import { geminiKeyStatus, nvidiaKeyStatus } from "@/lib/server/socialKeys";
import { bloggerReadiness, bloggerStatus } from "@/lib/server/socialBlogger";
import { resolveMetaSetup } from "@/lib/server/socialMeta";
import { Panel, SectionHeading } from "@/components/admin/ui";
import SocialComposer, { type SocialStatus } from "@/components/admin/SocialComposer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /admin/social: write one post and publish it to TARGET's Facebook Page, Instagram and the admin's
 * Blogger blog at once (AlphaPost-style). Admin only — the layout already ran requireAdminPage; the
 * status below mirrors GET /api/admin/social. Env vars show set/missing only; the Gemini key shows its
 * masked preview only; Blogger shows the connection + chosen blog, never a token.
 */
export default async function AdminSocial() {
  const { db, user } = await requireAdminPage();
  const cfg = metaConfig();
  // Composer readiness follows what publishing would use (own picked Page first, env config as the
  // fallback); the setup panel below keeps reporting the env configuration itself.
  const metaSetup = await resolveMetaSetup(user.id);
  const effectiveCfg = metaSetup.ready ? metaSetup.cfg : cfg;
  const blogger = await bloggerStatus(db, user.id);
  const status: SocialStatus = {
    meta: {
      vars: META_ENV_VARS.map((name) => ({ name, set: !!process.env[name]?.trim() })),
      pageId: cfg.pageId || null,
      igUserId: cfg.igUserId || null,
      graphVersion: cfg.graphVersion,
    },
    targets: { ...targetReadiness(effectiveCfg), blogger: await bloggerReadiness(db, user.id) },
    gemini: await geminiKeyStatus(db, user.id),
    nvidia: await nvidiaKeyStatus(db, user.id),
    blogger,
  };
  const missing = [...status.meta.vars.filter((v) => !v.set), ...blogger.vars.filter((v) => !v.set)];
  return (
    <>
      <SectionHeading title="Social posts" description="Write once, post to TARGET's Facebook Page, Instagram and your Blogger blog together. Drafts can be written by AI with your own saved key (NVIDIA when saved, else Gemini)." />
      <div className="mt-4" data-testid="social-status">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-soft">Setup</p>
          <ul className="mt-1.5 divide-y divide-line">
            {status.meta.vars.map((v) => (
              <li key={v.name} className="flex items-center justify-between gap-2 py-1.5">
                <code className="min-w-0 truncate font-mono text-[11px] text-ink-soft">{v.name}</code>
                <span className={`text-xs font-medium ${v.set ? "text-ok" : "text-muted-soft"}`}>{v.set ? "set" : "missing"}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-[11px] text-ink-soft">Facebook Page</span>
              <span className="text-xs text-muted">{status.meta.pageId ? `Target - Your Personal AI · ${status.meta.pageId}` : "not configured"}</span>
            </li>
            <li className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-[11px] text-ink-soft">Instagram</span>
              <span className="text-xs text-muted">{status.meta.igUserId ? `@gettarget.app · ${status.meta.igUserId}` : "not configured"}</span>
            </li>
            {blogger.vars.map((v) => (
              <li key={v.name} className="flex items-center justify-between gap-2 py-1.5">
                <code className="min-w-0 truncate font-mono text-[11px] text-ink-soft">{v.name}</code>
                <span className={`text-xs font-medium ${v.set ? "text-ok" : "text-muted-soft"}`}>{v.set ? "set" : "missing"}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-[11px] text-ink-soft">Blogger</span>
              <span className="text-xs text-muted">
                {blogger.connected
                  ? blogger.blog
                    ? `${blogger.blog.blogName || "Blog"} · ${blogger.blog.blogId}`
                    : `Connected${blogger.accountLabel ? ` as ${blogger.accountLabel}` : ""} · no blog chosen yet`
                  : "not connected"}
              </span>
            </li>
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Publishing to a target stays off until its missing server env vars are added on Vercel. The
              Gemini key and the Blogger connection are different: both are saved inside TARGET, in the
              cards below — never as env vars.
            </p>
          )}
        </Panel>
      </div>
      <div className="mt-4">
        <SocialComposer initial={status} />
      </div>
    </>
  );
}
