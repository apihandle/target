import { requireAdminPage } from "@/lib/server/adminAuth";
import { JOB_STATUSES, jobDurationMs, loadJobs } from "@/lib/server/adminData";
import { pageFrom } from "@/lib/adminConfig";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Chips, duration, Empty, fmt, LoadError, Pager, SectionHeading, sp, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { done: "ok", failed: "danger", running: "info", queued: "neutral", needs_approval: "warn", cancelled: "neutral" };

export default async function AdminJobs(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const params = { status: sp(raw.status), page: sp(raw.page) };
  const r = await loadJobs(db, { page: pageFrom(params.page), status: params.status });
  return (
    <>
      <SectionHeading title="Browser jobs" description="Newest first. Duration = from pick-up to finish. Open a job for its screenshot, step log and Stop / Retry. Inputs and code are never shown." />
      <Chips base="/admin/jobs" params={params} name="status" label="Status" options={JOB_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
      <div className="mt-4 space-y-2" data-testid="jobs-list">
        {r.error && <LoadError retryHref="/admin/jobs">Couldn&apos;t load browser jobs. Check that migration 0013 has run.</LoadError>}
        {!r.error && r.rows.length === 0 && <Empty title={params.status ? "No jobs with this status" : r.total ? "Nothing on this page" : "No browser jobs yet"} />}
        {r.rows.map((j) => (
          <div key={j.id} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="job-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
              <Badge>{j.mode}</Badge>
              <span>{fmt(j.created_at)}</span>
              <span className="ml-auto tabular-nums">{duration(jobDurationMs(j))}</span>
            </div>
            {j.goal.length > 160 ? (
              <details className="mt-2"><summary className="cursor-pointer break-words text-sm text-ink">{truncate(j.goal, 160)}</summary><p className="mt-1 break-words text-sm text-ink-soft">{j.goal}</p></details>
            ) : <p className="mt-2 break-words text-sm text-ink">{j.goal}</p>}
            {j.error && <p className="mt-1.5 break-words text-xs text-danger">{j.error}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <a href={`/admin/jobs/${j.id}`} className="text-xs font-medium text-accent hover:underline" data-testid="job-open">Open: screenshot, steps, Stop / Retry</a>
            </div>
            <a href={`/admin/users/${j.user_id}`} className="mt-1.5 block truncate text-xs text-accent hover:underline">{j.email || j.user_id}</a>
          </div>
        ))}
      </div>
      {!r.error && <Pager base="/admin/jobs" params={params} page={r.page} pages={r.pages} total={r.total} />}
    </>
  );
}
