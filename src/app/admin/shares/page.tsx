import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadShares } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge } from "@/components/ui/Badge";
import ConfirmAction from "@/components/admin/ConfirmAction";
import { Chips, Empty, fmt, LoadError, Pager, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminShares(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { state: sp(raw.state), page: sp(raw.page) };
  const r = await loadShares(db, { page: pageFrom(params.page), state: params.state });
  return (
    <>
      <SectionHeading title="Share links" description="Public /share links to chats. Only a hash of each token is stored, so the link itself can't be shown; revoking stops it at once." />
      <Chips base="/admin/shares" params={params} name="state" label="State" options={[{ value: "active", label: "active" }, { value: "revoked", label: "revoked" }]} />
      <div className="mt-4 space-y-2" data-testid="shares-list">
        {r.error && <LoadError retryHref="/admin/shares">Couldn&apos;t load share links. Check that migration 0008 has run.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.state ? `No ${params.state} share links` : r.total ? "Nothing on this page" : "No share links yet"} />}
        {r.rows.map((s) => (
          <div key={s.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between" data-testid="share-row">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={s.revoked_at ? "neutral" : "ok"}>{s.revoked_at ? "revoked" : "active"}</Badge>
                <span>Created {fmt(s.created_at)}</span>
                {s.revoked_at && <span>· revoked {fmt(s.revoked_at)}</span>}
              </div>
              <a href={`/admin/users/${s.user_id}`} className="mt-1.5 block truncate text-sm text-accent hover:underline">{s.email || s.user_id}</a>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-soft">link {s.id.slice(0, 8)} · chat {s.conversation_id.slice(0, 8)}</p>
            </div>
            {!s.revoked_at && (
              <ConfirmAction label="Revoke" title="Revoke this share link?" message="Anyone with the link loses access immediately. This can't be undone (the owner can make a new link)." confirmLabel="Revoke link" danger variant="danger"
                url={`/api/admin/shares/${s.id}/revoke`} testId="share-revoke" successText="Link revoked." />
            )}
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/shares" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
