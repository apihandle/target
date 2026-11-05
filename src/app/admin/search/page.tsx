import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { adminSearch } from "@/lib/server/adminStats";
import { Badge } from "@/components/ui/Badge";
import { Empty, fmt, LoadError, Panel, SearchBox, SectionHeading, sp, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

/** Global search from the top bar: users (email / id), browser jobs (id / goal text), errors (message text). */
export default async function AdminSearch(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const q = (sp((await props.searchParams).q) ?? "").trim();
  const r = await adminSearch(db, q);
  const none = q && !r.users.length && !r.jobs.length && !r.errors.length;
  return (
    <>
      <SectionHeading title="Search" description="Users by email or id, browser jobs by id or goal, errors by message." />
      <SearchBox base="/admin/search" params={{ q }} placeholder="Search email, job id, error text" />
      <div className="mt-4 space-y-4" data-testid="search-results">
        {r.error && <LoadError retryHref={`/admin/search?q=${encodeURIComponent(q)}`}>Part of the search failed; results may be incomplete.</LoadError>}
        {!q && <Empty title="Type something to search" />}
        {none && <Empty title={`Nothing found for “${truncate(q, 60)}”`} />}
        {r.users.length > 0 && (
          <Panel>
            <h3 className="text-sm font-semibold text-ink">Users</h3>
            <ul className="mt-2 divide-y divide-line">{r.users.map((u) => <li key={u.id} className="py-2"><Link href={`/admin/users/${u.id}`} className="block truncate text-sm text-accent hover:underline">{u.email || u.id}</Link><p className="text-xs text-muted">Joined {fmt(u.created_at)}</p></li>)}</ul>
          </Panel>
        )}
        {r.jobs.length > 0 && (
          <Panel>
            <h3 className="text-sm font-semibold text-ink">Browser jobs</h3>
            <ul className="mt-2 divide-y divide-line">{r.jobs.map((j) => <li key={j.id} className="py-2"><p className="break-words text-sm text-ink">{truncate(j.goal, 140)}</p><p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted"><Badge>{j.status}</Badge><span className="font-mono">{j.id.slice(0, 8)}</span><span>{fmt(j.created_at)}</span></p></li>)}</ul>
            <Link href="/admin/jobs" className="mt-2 inline-block text-xs text-accent hover:underline">All browser jobs →</Link>
          </Panel>
        )}
        {r.errors.length > 0 && (
          <Panel>
            <h3 className="text-sm font-semibold text-ink">Errors</h3>
            <ul className="mt-2 divide-y divide-line">{r.errors.map((e) => <li key={e.id} className="py-2"><p className="break-words text-sm text-ink">{truncate(e.message, 160)}</p><p className="mt-0.5 flex items-center gap-2 text-xs text-muted"><Badge>{e.source}</Badge>{fmt(e.created_at)}</p></li>)}</ul>
            <Link href={`/admin/errors?q=${encodeURIComponent(q)}`} className="mt-2 inline-block text-xs text-accent hover:underline">See all matching errors →</Link>
          </Panel>
        )}
      </div>
    </>
  );
}
