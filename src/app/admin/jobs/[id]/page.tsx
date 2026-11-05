import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { jobDurationMs, loadJobDetail } from "@/lib/server/adminData";
import { isUuid } from "@/lib/ids";
import { Badge, type Tone } from "@/components/ui/Badge";
import ConfirmAction from "@/components/admin/ConfirmAction";
import { duration, fmt, KV, LoadError, Panel } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { done: "ok", failed: "danger", running: "info", queued: "neutral", needs_approval: "warn", cancelled: "neutral" };
const CONTROL: Record<string, string> = { agent: "Agent is driving", paused: "Paused: waiting for the user", user: "User has control", stop: "Stopping" };

export default async function AdminJobDetail(props: { params: Promise<{ id: string }> }) {
  const { db } = await requireAdminPage();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const j = await loadJobDetail(db, id);
  if (j === null) notFound();
  const back = <Link href="/admin/jobs" className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">← Browser jobs</Link>;
  if (j === "error") return <>{back}<div className="mt-3"><LoadError retryHref={`/admin/jobs/${id}`}>Couldn&apos;t load this job.</LoadError></div></>;
  const active = ["queued", "running", "needs_approval"].includes(j.status);
  return (
    <>
      {back}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
            <Badge>{j.mode}</Badge>
            {j.control && <Badge tone={j.control === "agent" ? "neutral" : "warn"}>{CONTROL[j.control] ?? j.control}</Badge>}
          </div>
          <h2 className="mt-2 text-base [overflow-wrap:anywhere] font-semibold text-ink">{j.goal}</h2>
          <a href={`/admin/users/${j.user_id}`} className="mt-1 block break-all text-xs text-accent hover:underline">{j.email || j.user_id}</a>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="job-actions">
          <ConfirmAction label="Stop" title="Stop this job?" message={j.status === "running" ? "The browser stops after its current step." : "The job is cancelled before it starts."}
            confirmLabel="Stop" danger variant="danger" disabled={!active} url={`/api/admin/jobs/${j.id}`} body={{ action: "stop" }} testId="job-stop" successText="Stopping." />
          <ConfirmAction label="Retry" title="Run this job again?" message="A new job with the same goal and the same saved logins is queued for this user."
            confirmLabel="Retry" variant="primary" disabled={!!j.retry_block} url={`/api/admin/jobs/${j.id}`} body={{ action: "retry" }} testId="job-retry" successText="Queued again." />
        </div>
      </div>
      {j.retry_block && !active && <p className="mt-1 text-xs text-muted-soft" data-testid="job-retry-why">{j.retry_block}.</p>}

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel>
          <h3 className="text-sm font-semibold text-ink">Browser</h3>
          {j.live && active ? (
            <p className="mt-2 text-sm"><a href={j.live.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline" data-testid="job-live">Open live view ({j.live.provider})</a></p>
          ) : null}
          {j.frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={j.frame} alt="Last screenshot of the job's browser" className="mt-2 w-full rounded-xl border border-line" data-testid="job-frame" />
          ) : <p className="mt-2 text-sm text-muted">No screenshot kept for this job.</p>}
          {j.frame_url && <p className="mt-1 break-all text-xs text-muted">{j.frame_url}{j.frame_at ? ` · ${fmt(j.frame_at)}` : ""}</p>}
          {j.control_reason && <p className="mt-2 break-words text-sm text-ink-soft">Paused because: {j.control_reason}</p>}
        </Panel>
        <Panel>
          <h3 className="text-sm font-semibold text-ink">Details</h3>
          <dl className="mt-2 divide-y divide-line">
            <KV k="Created" v={fmt(j.created_at)} />
            <KV k="Picked up" v={fmt(j.claimed_at)} />
            <KV k="Finished" v={fmt(j.finished_at)} />
            <KV k="Duration" v={duration(jobDurationMs(j))} />
            {j.paused_until && <KV k="Paused until" v={fmt(j.paused_until)} />}
            {j.start_url && <KV k="Start page" v={<span className="break-all">{j.start_url}</span>} />}
          </dl>
          {j.error && <p className="mt-2 text-sm text-danger [overflow-wrap:anywhere]">{j.error}</p>}
          {j.result && <details className="mt-2"><summary className="cursor-pointer text-sm text-ink">Result</summary><p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-ink-soft">{j.result.slice(0, 4000)}</p></details>}
        </Panel>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-ink">Step log</h3>
      {j.log.length === 0 ? <p className="mt-2 text-sm text-muted">No steps yet.</p> : (
        <ol className="mt-2 min-w-0 space-y-1 overflow-x-auto rounded-2xl border border-line bg-surface/80 p-3 font-mono text-[12px] leading-relaxed text-ink-soft" data-testid="job-log">
          {j.log.map((l, i) => <li key={i} className="[overflow-wrap:anywhere]"><span className="mr-2 text-muted-soft">{i + 1}.</span>{l}</li>)}
        </ol>
      )}
      <p className="mt-6 text-xs text-muted-soft">Job inputs, code and vault values are never shown here.</p>
    </>
  );
}
