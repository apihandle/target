import { requireAdminPage } from "@/lib/server/adminAuth";
import { APPROVAL_STATUSES, loadApprovals } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge, toneFor } from "@/components/ui/Badge";
import { Chips, Empty, fmt, LoadError, Pager, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminApprovals(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { status: sp(raw.status), auto: sp(raw.auto), page: sp(raw.page) };
  const r = await loadApprovals(db, { page: pageFrom(params.page), status: params.status, auto: params.auto });
  return (
    <>
      <SectionHeading title="Approvals" description="Every approval card, newest first. Auto = approved in code by Task mode. Payloads (email text, card details) are never shown." />
      <div className="flex flex-col gap-2">
        <Chips base="/admin/approvals" params={params} name="status" label="Status" options={APPROVAL_STATUSES.map((s) => ({ value: s, label: s }))} />
        <Chips base="/admin/approvals" params={params} name="auto" label="Decided by" options={[{ value: "auto", label: "Task mode (auto)" }, { value: "user", label: "User" }]} />
      </div>
      <div className="mt-4 space-y-2" data-testid="approvals-list">
        {r.error && <LoadError retryHref="/admin/approvals">Couldn&apos;t load approvals.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.status || params.auto ? "No approvals match" : "No approvals yet"} />}
        {r.rows.map((x) => (
          <div key={x.id} className="rounded-2xl border border-line bg-surface/80 p-4" data-testid="approval-row">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge tone={toneFor(x.status)}>{x.status}</Badge>
              {x.auto ? <Badge tone="warn">auto (Task mode)</Badge> : null}
              <Badge>{x.action_type}</Badge>
              <span className="ml-auto">{fmt(x.created_at)}</span>
            </div>
            <p className="mt-2 text-sm text-ink [overflow-wrap:anywhere]">{x.summary}</p>
            {x.error && <p className="mt-1 text-xs text-danger [overflow-wrap:anywhere]">{x.error}</p>}
            <a href={`/admin/users/${x.user_id}`} className="mt-1.5 block truncate text-xs text-accent hover:underline">{x.email || x.user_id}</a>
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/approvals" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
