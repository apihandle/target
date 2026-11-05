import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadCronStatus, loadScheduled, SCHEDULE_STATUSES } from "@/lib/server/adminData";
import { getAdminSettings } from "@/lib/server/adminSettings";
import { pageFrom } from "@/lib/adminConfig";
import { Badge, toneFor } from "@/components/ui/Badge";
import { Chips, Empty, fmt, KV, LoadError, Pager, Panel, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminScheduled(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { status: sp(raw.status), page: sp(raw.page) };
  const [r, cron, settings] = await Promise.all([loadScheduled(db, { page: pageFrom(params.page), status: params.status }), loadCronStatus(db), getAdminSettings(db)]);
  return (
    <>
      <SectionHeading title="Scheduled tasks & cron" description="Prompt text is private and not shown; titles only." />
      <Panel className="mt-4" testId="cron-status">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Cron runs</h3>
          {!settings.features.scheduled && <Badge tone="warn">Scheduled tasks switched off</Badge>}
        </div>
        {cron.error && <p className="mt-1 text-xs text-warn">Cron heartbeats need migration 0019. Showing the last scheduled prompt run instead.</p>}
        <dl className="mt-2 divide-y divide-line">
          <KV k="Scheduled prompts cron" v={cron.scheduled ? `${fmt(cron.scheduled.at)} · ${cron.scheduled.by ?? "cron"} · ${cron.scheduled.disabled ? "paused" : `${cron.scheduled.ran ?? 0} ran`}` : "No run recorded yet"} />
          <KV k="For-you scan cron" v={cron.proactive ? `${fmt(cron.proactive.at)} · ${cron.proactive.by ?? "cron"} · ${cron.proactive.scanned ?? 0} scanned` : "No run recorded yet"} />
          <KV k="Last scheduled prompt run" v={fmt(cron.lastJobRun)} />
        </dl>
        <Link href="/admin/controls#c-cron" className="mt-2 inline-block text-xs text-accent hover:underline">Run cron now →</Link>
      </Panel>

      <Chips base="/admin/scheduled" params={params} name="status" label="Status" options={SCHEDULE_STATUSES.map((s) => ({ value: s, label: s }))} />
      <div className="mt-4 space-y-2" data-testid="scheduled-list">
        {r.error && <LoadError retryHref="/admin/scheduled">Couldn&apos;t load scheduled prompts. Check that migration 0008 has run.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.status ? "No scheduled prompts with this status" : r.total ? "Nothing on this page" : "No scheduled prompts yet"} />}
        {r.rows.map((j) => (
          <div key={j.id} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="scheduled-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={toneFor(j.status)}>{j.status}</Badge>
              <Badge>{j.cadence} · {j.time_of_day} {j.timezone}</Badge>
              {j.last_status && <Badge tone={j.last_error ? "danger" : "neutral"}>last: {j.last_status}</Badge>}
              <span className="ml-auto tabular-nums">{j.run_count} runs</span>
            </div>
            <p className="mt-2 break-words text-sm text-ink">{j.title}</p>
            <dl className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-muted sm:grid-cols-2">
              <div><dt className="inline text-muted-soft">Next </dt><dd className="inline">{fmt(j.next_run_at)}</dd></div>
              <div><dt className="inline text-muted-soft">Last </dt><dd className="inline">{fmt(j.last_run_at)}</dd></div>
            </dl>
            {j.last_error && <p className="mt-1 break-words text-xs text-danger">{j.last_error}</p>}
            <a href={`/admin/users/${j.user_id}`} className="mt-1.5 block truncate text-xs text-accent hover:underline">{j.email || j.user_id}</a>
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/scheduled" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
