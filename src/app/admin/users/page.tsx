import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { isBanned, loadUsers } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge } from "@/components/ui/Badge";
import { Empty, fmt, LoadError, num, Pager, SearchBox, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminUsers(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { q: sp(raw.q), page: sp(raw.page) };
  const r = await loadUsers(db, { q: params.q, page: pageFrom(params.page) });
  const exportHref = `/api/admin/users/export${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`;
  return (
    <>
      <SectionHeading title="Users" description="Newest first. Search by email or user id."
        actions={<a href={exportHref} download className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3" data-testid="users-export">Export CSV</a>} />
      <SearchBox base="/admin/users" params={params} placeholder="Search email or id" />
      <div className="mt-4 space-y-2" data-testid="users-list">
        {r.error && <LoadError retryHref="/admin/users">Couldn&apos;t load users. Check SUPABASE_SERVICE_ROLE_KEY.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.q ? "No users match that search" : r.total ? "Nothing on this page" : "No users yet"}>{params.q ? <Link href="/admin/users" className="underline">Clear search</Link> : null}</Empty>}
        {r.rows.map((u) => (
          <Link key={u.id} href={`/admin/users/${u.id}`} className="block rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl transition hover:bg-surface-2" data-testid="user-row">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{u.email || "(no email)"}</p>
              {isBanned(u) && <Badge tone="danger">Disabled</Badge>}
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted sm:grid-cols-4">
              <div><dt className="inline text-muted-soft">Joined </dt><dd className="inline">{fmt(u.created_at)}</dd></div>
              <div><dt className="inline text-muted-soft">Last sign-in </dt><dd className="inline">{fmt(u.last_sign_in_at)}</dd></div>
              <div><dt className="inline text-muted-soft">Messages </dt><dd className="inline tabular-nums">{num(u.messages)}</dd></div>
              <div><dt className="inline text-muted-soft">Via </dt><dd className="inline">{u.provider}</dd></div>
            </dl>
          </Link>
        ))}
      </div>
      {!r.error && <Pager base="/admin/users" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
