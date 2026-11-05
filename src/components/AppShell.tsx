import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import Sidebar, { type Section } from "@/components/Sidebar";
import WelcomeTour from "@/components/WelcomeTour";
import SessionKeeper from "@/components/SessionKeeper";
import { getAdminSettings } from "@/lib/server/adminSettings";

/** Authenticated workspace frame: resolves the user, loads nav data, renders sidebar + main. */
export async function getSessionOrRedirect(next: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

export default async function AppShell({ user, section, activeId, children }: { user: User; section: Section; activeId?: string; children: React.ReactNode }) {
  const supabase = await createClient();
  const [convRes, { count: pending }, admin] = await Promise.all([
    supabase.from("conversations").select("id, title, pinned").eq("user_id", user.id).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(40),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
    getAdminSettings(),
  ]);
  const banner = admin.announcement.enabled ? admin.announcement.text : "";
  let convs = convRes.data as { id: string; title: string; pinned?: boolean }[] | null;
  // Before migration 0008 there is no pinned column: fall back to the plain list.
  if (convRes.error) convs = (await supabase.from("conversations").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(40)).data;
  return (
    <div className="relative isolate flex h-[100dvh] bg-bg text-ink">
      <SessionKeeper />
      {/* Night-water backdrop, same footage as the landing page, kept still and dim so text stays readable */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/water-poster.webp" alt="" className="h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/70 via-bg/80 to-bg/95" />
      </div>
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-50 rounded bg-accent px-3 py-2 text-sm text-accent-ink">Skip to content</a>
      <Sidebar conversations={convs ?? []} activeId={activeId} email={user.email ?? ""} section={section} pendingApprovals={pending ?? 0} />
      <main id="main" className={`min-w-0 flex-1 overflow-y-auto ${banner ? "flex flex-col" : ""}`}>
        {/* Site-wide announcement set in /admin → Controls (plain text, React-escaped). Chat keeps its full height under it. */}
        {banner ? (
          <>
            <div role="status" data-testid="site-announcement" className="shrink-0 border-b border-accent/25 bg-accent-subtle/95 py-2.5 pl-14 pr-4 text-sm leading-snug text-accent-strong md:pl-4">
              <p className="mx-auto max-w-4xl break-words">{banner}</p>
            </div>
            <div className="min-h-0 flex-1">{children}</div>
          </>
        ) : children}
      </main>
      <WelcomeTour />
    </div>
  );
}
