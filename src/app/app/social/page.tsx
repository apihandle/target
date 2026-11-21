import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import SocialComposer, { type SocialStatus } from "@/components/admin/SocialComposer";
import { Page, PageHeader } from "@/components/ui/Card";
import { metaGraphVersion, type SocialTarget } from "@/lib/socialConfig";
import { isAdminUser } from "@/lib/server/adminCheck";
import type { Db } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { geminiKeyStatus } from "@/lib/server/socialKeys";
import { bloggerReadiness, bloggerStatus } from "@/lib/server/socialBlogger";
import { metaPublicInfo, metaTargetReadiness } from "@/lib/server/socialMeta";

export const dynamic = "force-dynamic";
export const metadata = { title: "Social posts · TARGET" };

/**
 * /app/social: the social composer for every signed-in user (the user-level twin of /admin/social).
 * Same composer component, but every destination is the caller's OWN account: their picked Facebook
 * Page + its Instagram (connected on /app/connectors), their Blogger blog, and drafts written with
 * their own Gemini key. The env-configured owner Page is never offered here — metaTargetReadiness
 * only falls back to it for the site owner (admin), mirroring the publish route's guard.
 */
export default async function SocialPage() {
  const { supabase, user } = await getSessionOrRedirect("/app/social");
  const db = supabase as unknown as Db;
  const info = await metaPublicInfo(user.id).catch(() => null);
  const metaTargets = await metaTargetReadiness(user.id, process.env, { envFallback: isAdminUser(user) });
  const blogger = await bloggerStatus(db, user.id);
  const status: SocialStatus = {
    meta: {
      vars: [],
      pageId: info?.page?.id ?? null,
      igUserId: info?.instagram?.id ?? null,
      graphVersion: metaGraphVersion(process.env),
    },
    targets: { ...metaTargets, blogger: await bloggerReadiness(db, user.id) },
    gemini: await geminiKeyStatus(serviceDb(db), user.id),
    blogger,
  };
  const hints: Partial<Record<SocialTarget, string>> = {
    ...(info?.page ? { facebook: `Your Page · ${info.page.name}` } : {}),
    ...(info?.instagram ? { instagram: `@${info.instagram.username || info.instagram.id} · needs a public image URL` } : {}),
  };
  const firstReady = (["facebook", "instagram", "blogger"] as SocialTarget[]).filter((t) => status.targets[t].ready);
  return (
    <AppShell user={user} section="social">
      <Page wide>
        <PageHeader
          title="Social posts"
          description="Write once, post to your own Facebook Page, Instagram and Blogger blog together. Connect the accounts on the Connectors page first — posts only ever go to accounts you connected yourself."
        />
        <div className="mt-6">
          <SocialComposer
            initial={status}
            apiBase="/api/social"
            confirmNote="It posts only to the accounts you connected."
            targetHints={hints}
            defaultTargets={firstReady.length ? [firstReady[0]] : []}
          />
        </div>
      </Page>
    </AppShell>
  );
}
