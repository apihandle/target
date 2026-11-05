import { requireAdminPage } from "@/lib/server/adminAuth";
import { ERROR_SOURCES, loadErrors } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge } from "@/components/ui/Badge";
import { Chips, Empty, fmt, LoadError, Pager, SearchBox, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminErrors(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { source: sp(raw.source), q: sp(raw.q), page: sp(raw.page) };
  const r = await loadErrors(db, { page: pageFrom(params.page), source: params.source, q: params.q });
  const qs = new URLSearchParams(Object.entries({ source: params.source, q: params.q }).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <>
      <SectionHeading title="Errors" description="error_events, newest first. Secrets are redacted when errors are recorded."
        actions={<a href={`/api/admin/errors/export${qs ? `?${qs}` : ""}`} download className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3" data-testid="errors-export">Export CSV</a>} />
      <Chips base="/admin/errors" params={params} name="source" label="Source" options={ERROR_SOURCES.map((s) => ({ value: s, label: s }))} />
      <SearchBox base="/admin/errors" params={params} placeholder="Search error messages" />
      <div className="mt-4 space-y-2" data-testid="errors-list">
        {r.error && <LoadError retryHref="/admin/errors">Couldn&apos;t load errors. Check that migration 0009 has run.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.q || params.source ? "No errors match these filters" : r.total ? "Nothing on this page" : "No errors. All quiet."} />}
        {r.rows.map((e) => (
          <div key={e.id} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="error-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={e.source === "client" ? "info" : e.source === "cron" ? "warn" : "danger"}>{e.source}</Badge>
              <span>{fmt(e.created_at)}</span>
              {e.user_id && <a href={`/admin/users/${e.user_id}`} className="ml-auto text-accent hover:underline">User →</a>}
            </div>
            <p className="mt-2 break-words text-sm text-ink">{e.message}</p>
            {e.url && <p className="mt-1 break-all text-xs text-muted-soft">{e.url}</p>}
            {e.stack ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Stack</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg/80 p-3 font-mono text-[11px] leading-relaxed text-ink-soft">{e.stack}</pre>
              </details>
            ) : <p className="mt-2 text-xs text-muted-soft">No stack recorded.</p>}
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/errors" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
