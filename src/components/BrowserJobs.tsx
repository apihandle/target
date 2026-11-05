"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, type Tone } from "@/components/ui/Badge";

type Step = { action: string; url?: string; selector?: string; value?: string; key?: string; ms?: number; field?: string };
type Job = { id: string; goal: string; start_url: string | null; steps: Step[]; status: string; result: string | null; error: string | null; created_at: string; mode?: string; log?: string[]; files?: { name: string; url: string }[]; language?: string | null };
const MODE: Record<string, string> = { auto: "Smart browser", steps: "Browser steps", code: "Code", video: "Video" };
const STATUS: Record<string, [string, Tone]> = {
  needs_approval: ["Needs your approval", "warn"], queued: ["Waiting for the browser", "info"], running: ["Running", "accent"],
  done: ["Done", "ok"], failed: ["Failed", "danger"], cancelled: ["Cancelled", "neutral"],
};
const stepText = (s: Step) => s.action === "goto" ? `Open ${s.url}` : s.action === "click" ? `Click ${s.selector}` : s.action === "fill" ? `Type into ${s.selector}` :
  s.action === "fill_secret" ? `Fill ${s.field} from your vault into ${s.selector}` : s.action === "press" ? `Press ${s.key}` : s.action === "wait" ? `Wait ${s.ms} ms` : `Read ${s.selector || "the page"}`;

export default function BrowserJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [worker, setWorker] = useState(true);
  const [error, setError] = useState("");
  const load = async () => { const r = await fetch("/api/browser-jobs", { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) setError(j.error ?? "Couldn't load"); setJobs(j.jobs ?? []); setWorker(!!j.worker); };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; state is set from the async fetch result
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  async function act(id: string, action: "approve" | "cancel") {
    const r = await fetch(`/api/browser-jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!r.ok) setError("Couldn't update this task."); load();
  }
  if (!jobs) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-3" data-testid="browser-jobs">
      {!worker && <p className="rounded-2xl border border-accent/30 bg-surface/70 p-4 text-sm text-muted">The browser worker isn&apos;t connected yet, so tasks wait in the queue until it is set up.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!jobs.length && <p className="rounded-2xl border border-line bg-surface/60 p-5 text-sm text-muted">No browser tasks yet. Ask TARGET to do something on a website.</p>}
      {jobs.map((j) => {
        const [label, tone] = STATUS[j.status] ?? [j.status, "neutral" as Tone];
        return (
          <article key={j.id} className="rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium"><span className="truncate">{j.goal}</span><Badge tone={tone}>{label}</Badge></p>
                <p className="mt-1 truncate text-xs text-muted-soft">{MODE[j.mode ?? "steps"]}{j.mode === "code" && j.language ? ` · ${j.language}` : ""}{j.start_url ? ` · ${j.start_url}` : ""}</p>
              </div>
              <div className="flex gap-2">
                {j.status === "needs_approval" && <Button size="sm" variant="approve" onClick={() => act(j.id, "approve")}>Approve</Button>}
                {(j.status === "needs_approval" || j.status === "queued") && <Button size="sm" onClick={() => act(j.id, "cancel")}>Cancel</Button>}
              </div>
            </div>
            {!!j.steps?.length && <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">{j.steps.map((s, i) => <li key={i} className="break-all">{stepText(s)}</li>)}</ol>}
            {!!j.log?.length && <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">{j.log.map((l, i) => <li key={i} className="break-words">{l}</li>)}</ol>}
            {!!j.files?.length && <p className="mt-3 flex flex-wrap gap-3 text-xs">{j.files.map((f) => <a key={f.url} href={f.url} className="text-accent-strong underline">{f.name}</a>)}</p>}
            {j.result && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/70 p-3 text-xs text-ink-soft">{j.result}</pre>}
            {j.error && <p className="mt-2 text-xs text-danger">{j.error}</p>}
          </article>
        );
      })}
    </div>
  );
}
