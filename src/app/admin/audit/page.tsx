import { requireAdminPage } from "@/lib/server/adminAuth";
import { AUDIT_ACTIONS, loadAudit } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge } from "@/components/ui/Badge";
import { Chips, Empty, fmt, LoadError, Pager, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

function describe(detail: Record<string, unknown>): string {
  return Object.entries(detail ?? {}).filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 300);
}

export default async function AdminAudit(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { action: sp(raw.action), page: sp(raw.page) };
  const r = await loadAudit(db, { page: pageFrom(params.page), action: params.action });
  return (
    <>
      <SectionHeading title="Audit log" description="Every admin action: who, what and when. Entries can't be edited or deleted from the app." />
      <Chips base="/admin/audit" params={params} name="action" label="Action" options={AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))} />
      <div className="mt-4 space-y-2" data-testid="audit-list">
        {r.error && <LoadError retryHref="/admin/audit">Couldn&apos;t load the audit log. Run supabase/migrations/0019_admin.sql.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.action ? "No entries for this action" : r.total ? "Nothing on this page" : "No admin actions yet"} />}
        {r.rows.map((e) => (
          <div key={e.id} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="audit-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={e.detail?.failed ? "danger" : "accent"}>{e.action}{e.detail?.failed ? " · failed" : ""}</Badge>
              <span>{fmt(e.created_at)}</span>
            </div>
            <p className="mt-1.5 break-all text-sm text-ink">{e.actor_email || "(unknown admin)"}</p>
            {(e.target_type || e.target_id) && <p className="mt-0.5 break-all text-xs text-muted">{e.target_type}{e.target_id ? ` · ${e.target_id}` : ""}</p>}
            {describe(e.detail) && <p className="mt-0.5 break-words text-xs text-muted-soft">{describe(e.detail)}</p>}
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/audit" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
