import { requireAdminPage } from "@/lib/server/adminAuth";
import { ACTIVITY_CATEGORIES, loadActivity } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge, toneFor } from "@/components/ui/Badge";
import { Chips, Empty, fmt, LoadError, Pager, SectionHeading, sp, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminActivity(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { category: sp(raw.category), page: sp(raw.page) };
  const r = await loadActivity(db, { page: pageFrom(params.page), category: params.category });
  return (
    <>
      <SectionHeading title="Activity" description="What TARGET did for every user (tasks, approvals, outcomes…), newest first." />
      <Chips base="/admin/activity" params={params} name="category" label="Type" options={ACTIVITY_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <div className="mt-4 space-y-2" data-testid="activity-list">
        {r.error && <LoadError retryHref="/admin/activity">Couldn&apos;t load activity. Check that migration 0006 has run.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.category ? "No activity of this type" : r.total ? "Nothing on this page" : "No activity yet"} />}
        {r.rows.map((e) => (
          <div key={e.id} className="rounded-2xl border border-line bg-surface/80 p-4" data-testid="activity-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge>{e.category}</Badge>
              {e.status && <Badge tone={toneFor(e.status)}>{e.status}</Badge>}
              <span className="ml-auto">{fmt(e.created_at)}</span>
            </div>
            <p className="mt-1.5 break-words text-sm text-ink">{e.title}</p>
            {e.detail && <p className="mt-0.5 break-words text-xs text-muted">{truncate(e.detail, 200)}</p>}
            <a href={`/admin/users/${e.user_id}`} className="mt-1.5 block truncate text-xs text-accent hover:underline">{e.email || e.user_id}</a>
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/activity" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
