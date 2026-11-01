import Link from "next/link";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import PanelCard from "@/components/PanelCard";
import QuickActions from "@/components/QuickActions";
import ApprovalCard from "@/components/ApprovalCard";
import TaskList from "@/components/TaskList";
import ActivityTimeline from "@/components/ActivityTimeline";
import { Card, Page, SectionTitle } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PANEL_COLS, type Panel } from "@/lib/panels";
import { TASK_COLS, type Task } from "@/lib/tasks";
import { APPROVAL_COLS, type Approval } from "@/lib/approvals";
import { ACTIVITY_COLS, type ActivityEvent } from "@/lib/activity";
import { loadSettings } from "@/lib/settings";
import ForYou, { type ForYouItem } from "@/components/ForYou";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · TARGET" };

export default async function HomePage() {
  const { supabase, user } = await getSessionOrRedirect("/app/home");
  const [{ data: panels }, { data: tasks, error: tErr }, { data: approvals }, { data: events }, settings, { data: forYou }] = await Promise.all([
    supabase.from("panels").select(PANEL_COLS).eq("user_id", user.id).order("position").order("created_at").limit(6),
    supabase.from("tasks").select(TASK_COLS).eq("user_id", user.id).in("status", ["queued", "planning", "in_progress", "failed"]).order("updated_at", { ascending: false }).limit(6),
    supabase.from("approval_requests").select(APPROVAL_COLS).eq("user_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("activity_events").select(ACTIVITY_COLS).eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    loadSettings(supabase, user.id),
    // Before migration 0014 the table doesn't exist; the section simply stays hidden.
    supabase.from("suggestions").select("id, kind, title, detail, prompt, due_at").eq("user_id", user.id).eq("status", "open").order("created_at", { ascending: false }).limit(4),
  ]);
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  const name = (meta?.full_name || meta?.name || "").split(" ")[0] || undefined;
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const pending = (approvals ?? []) as Approval[];

  return (
    <AppShell user={user} section="home">
      <Page wide>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{greet}{name ? `, ${name}` : ""}</h1>
          <p className="mt-1.5 text-sm text-muted">Here&apos;s what needs you and what&apos;s moving.</p>
        </header>

        <section aria-labelledby="qa-title" className="mt-6">
          <h2 id="qa-title" className="sr-only">Quick actions</h2>
          <QuickActions actions={settings.quick_actions} hidden={settings.hidden_quick_actions} />
        </section>

        {tErr && (
          <div role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">
            Some workspace data couldn&apos;t load. If this is a new install, apply the database migrations in <code>supabase/migrations</code> (see README).
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            {!!forYou?.length && (
              <section aria-labelledby="fy-title">
                <SectionTitle id="fy-title">For you</SectionTitle>
                <ForYou initial={forYou as ForYouItem[]} />
              </section>
            )}
            <section aria-labelledby="attn-title">
              <SectionTitle id="attn-title" action={pending.length ? <Link href="/app/activity?filter=approvals" className="text-xs text-muted hover:text-ink">All approvals</Link> : undefined}>Needs your attention</SectionTitle>
              {pending.length === 0 ? (
                <EmptyState title="Nothing waiting on you" testId="attention-empty">When TARGET prepares something that would act outside this app, it will wait here for your approval.</EmptyState>
              ) : (
                <div className="space-y-3">{pending.map((a) => <ApprovalCard key={a.id} id={a.id} initial={a} />)}</div>
              )}
            </section>
            <section aria-labelledby="tasks-title">
              <SectionTitle id="tasks-title" action={<Link href="/app/projects" className="text-xs text-muted hover:text-ink">Projects</Link>}>Open tasks</SectionTitle>
              <TaskList initial={(tasks ?? []) as Task[]} emptyText="No open tasks. Add one here or inside a project." />
            </section>
          </div>
          <div className="space-y-6">
            <section aria-labelledby="panels-title">
              <SectionTitle id="panels-title" action={<LinkButton href="/app/panels" size="sm" variant="ghost">Manage</LinkButton>}>Panels</SectionTitle>
              {(panels ?? []).length === 0 ? (
                <EmptyState title="No panels yet" action={<LinkButton href="/app/panels" size="sm" variant="primary">Create a panel</LinkButton>}>Track a goal, a to-do list, a countdown, weather or a price.</EmptyState>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {((panels ?? []) as Panel[]).map((p) => <PanelCard key={p.id} p={p} compact />)}
                </div>
              )}
            </section>
            <section aria-labelledby="act-title">
              <SectionTitle id="act-title" action={<Link href="/app/activity" className="text-xs text-muted hover:text-ink">View all</Link>}>Recent activity</SectionTitle>
              <Card><ActivityTimeline events={(events ?? []) as ActivityEvent[]} /></Card>
            </section>
          </div>
        </div>
      </Page>
    </AppShell>
  );
}
