import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import Sidebar, { type Section } from "@/components/Sidebar";

/** Authenticated workspace frame: resolves the user, loads nav data, renders sidebar + main. */
export async function getSessionOrRedirect(next: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

export default async function AppShell({ user, section, activeId, children }: { user: User; section: Section; activeId?: string; children: React.ReactNode }) {
  const supabase = createClient();
  const [{ data: convs }, { count: pending }] = await Promise.all([
    supabase.from("conversations").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(40),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
  ]);
  return (
    <div className="flex h-[100dvh] bg-bg text-ink">
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-50 rounded bg-accent px-3 py-2 text-sm text-accent-ink">Skip to content</a>
      <Sidebar conversations={convs ?? []} activeId={activeId} email={user.email ?? ""} section={section} pendingApprovals={pending ?? 0} />
      <main id="main" className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
