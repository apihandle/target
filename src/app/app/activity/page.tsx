import Link from "next/link";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import ActivityTimeline from "@/components/ActivityTimeline";
import ApprovalCard from "@/components/ApprovalCard";
import { Card, Page, PageHeader, SectionTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import ClearActivity from "@/components/ClearActivity";
import { ACTIVITY_COLS, ACTIVITY_FILTERS, parseFilter, type ActivityEvent } from "@/lib/activity";
import { APPROVAL_COLS, type Approval } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity · TARGET" };

const TABS = [
  { id: "all", label: "Everything" },
  { id: "tasks", label: "Tasks" },
  { id: "approvals", label: "Approvals" },
  { id: "outcomes", label: "Outcomes" },
] as const;

export default async function ActivityPage({ searchParams }: { searchParams: { filter?: string } }) {
  const { supabase, user } = await getSessionOrRedirect("/app/activity");
  const filter = parseFilter(searchParams.filter);
  const cats = ACTIVITY_FILTERS[filter];
  let q = supabase.from("activity_events").select(ACTIVITY_COLS).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
  if (cats) q = q.in("category", cats as unknown as string[]);
  const [{ data: events, error }, { data: approvals }, { data: projects }] = await Promise.all([
    q,
    supabase.from("approval_requests").select(APPROVAL_COLS).eq("user_id", user.id).in("status", ["pending", "failed"]).order("created_at", { ascending: false }).limit(20),
    supabase.from("projects").select("id, name").eq("user_id", user.id),
  ]);
  const names = Object.fromEntries((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const open = (approvals ?? []) as Approval[];

  return (
    <AppShell user={user} section="activity">
      <Page>
        <PageHeader title="Activity" description="A record of what you and TARGET did: tasks, approval decisions and their real outcomes." />
        {(filter === "all" || filter === "approvals") && (
          <section aria-labelledby="pending-title" className="mt-8">
            <SectionTitle id="pending-title">Waiting for you</SectionTitle>
            {open.length === 0 ? <EmptyState title="No approvals waiting" testId="approvals-empty">Actions TARGET prepares for you appear here before anything happens.</EmptyState>
              : <div className="space-y-3">{open.map((a) => <ApprovalCard key={a.id} id={a.id} initial={a} />)}</div>}
          </section>
        )}
        <section aria-labelledby="hist-title" className="mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="hist-title" className="text-sm font-semibold">History</h2>
            <nav aria-label="Filter activity" className="flex flex-wrap gap-1">
              {TABS.map((t) => (
                <Link key={t.id} href={t.id === "all" ? "/app/activity" : `/app/activity?filter=${t.id}`} aria-current={filter === t.id ? "page" : undefined} data-testid={`activity-filter-${t.id}`}
                  className={`rounded-full px-3 py-1.5 text-xs ${filter === t.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>{t.label}</Link>
              ))}
            </nav>
          </div>
          {error ? (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-subtle px-4 py-3 text-sm text-danger">Activity couldn&apos;t load. <Link href="/app/activity" className="underline">Retry</Link></p>
          ) : (
            <Card><ActivityTimeline events={(events ?? []) as ActivityEvent[]} projectNames={names} /></Card>
          )}
          {(events ?? []).length > 0 && filter === "all" && <div className="mt-4"><ClearActivity /></div>}
        </section>
      </Page>
    </AppShell>
  );
}
