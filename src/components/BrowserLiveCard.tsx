"use client";
import { failureLine } from "@/lib/jobFailure";
import { useCallback, useEffect, useState } from "react";
import { isActive, stepText } from "@/lib/browserProgress";
import { CHECK_LINE, safeLiveUrl, type Control, type ViewMode } from "@/lib/liveView";

export type LiveJob = {
  id: string; goal: string; start_url: string; status: string; log: string[]; error?: string | null;
  live?: { provider: string; url: string; interactive: boolean } | null; mode?: ViewMode;
  frame?: string | null; frame_url?: string | null; control?: Control | null; control_reason?: string | null;
};

function title(job: LiveJob): string {
  if (job.status === "queued") return job.control === "paused" || job.control === "user" ? "Needs you" : "Starting the browser";
  if (job.status === "running") return job.control === "paused" ? "Needs you" : job.control === "user" ? "You're in control" : job.control === "stop" ? "Stopping" : "Browser at work";
  if (job.status === "done") return "Done";
  if (job.status === "cancelled") return "Stopped";
  return "Failed";
}

/**
 * The cloud browser in this chat: live view (interactive where the provider has one, else screenshots every ~2 s),
 * current page and step, Stop / Take control / Continue. When the task ends it shows the final screenshot and status.
 */
export default function BrowserLiveCard({ conversationId, streaming, firstDelayMs = 3000, pollMs = 1500 }: { conversationId?: string; streaming: boolean; firstDelayMs?: number; pollMs?: number }) {
  const [job, setJob] = useState<LiveJob | null>(null);
  const [seen, setSeen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!conversationId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let active = false;
      try {
        const r = await fetch(`/api/browser-jobs/live?c=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as { job: LiveJob | null }) : { job: null };
        if (stop) return;
        setJob(j.job);
        active = !!j.job && isActive(j.job.status);
        if (active) setSeen(true);
      } catch { /* try again next tick */ }
      if (!stop && (active || streaming)) timer = setTimeout(tick, pollMs);
    };
    // First look after a short pause: browser tasks never finish in under a few seconds.
    timer = setTimeout(tick, firstDelayMs);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [conversationId, streaming, firstDelayMs, pollMs]);

  const act = useCallback(async (action: "take" | "continue" | "stop") => {
    if (!job) return;
    setBusy(true); setNote("");
    try {
      const r = await fetch(`/api/browser-jobs/${job.id}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = (await r.json().catch(() => ({}))) as { control?: Control; status?: string; error?: string };
      if (!r.ok) setNote(j.error ?? "Couldn't do that");
      else setJob({ ...job, ...(j.control ? { control: j.control } : {}), ...(j.status ? { status: j.status } : {}) });
      if (action === "take" && r.ok) setExpanded(true);
      if (action !== "take") setExpanded(false);
    } catch { setNote("Couldn't do that"); }
    setBusy(false);
  }, [job]);

  if (!job) return null;
  const active = isActive(job.status);
  if (!seen && !(streaming && active)) return null;

  let host = "";
  try { host = new URL(job.start_url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  const steps = job.log.map(stepText).filter((s) => s !== "Finished");
  const liveUrl = active ? safeLiveUrl(job.live?.url) : null;
  const interactive = !!(liveUrl && job.live?.interactive);
  const control = job.control ?? "agent";
  const inControl = control === "user";
  const paused = control === "paused";
  const mode: ViewMode = interactive ? "iframe" : job.frame ? "screens" : "none";

  const view = (full: boolean) => mode === "none" ? null : (
    <div className={full ? "relative flex-1 bg-black" : "relative mt-2 aspect-[16/10] w-full overflow-hidden rounded-xl border border-white/10 bg-black"}>
      {mode === "iframe" ? (
        <iframe
          data-testid="browser-live-frame" title="Live browser" src={liveUrl!}
          className="absolute inset-0 h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
          allow="clipboard-read; clipboard-write; fullscreen" referrerPolicy="no-referrer"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img data-testid="browser-live-shot" alt={active ? "Browser screen" : "Final screen"} src={`data:image/jpeg;base64,${job.frame}`} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {/* Taps go to the page only while the user has control; otherwise a tap opens the full-screen view. */}
      {!inControl && !full && (
        <button type="button" aria-label="Expand" data-testid="browser-live-expand" onClick={() => setExpanded(true)} className="absolute inset-0 h-full w-full cursor-zoom-in bg-transparent" />
      )}
      {!inControl && full && mode === "iframe" && <div aria-hidden className="absolute inset-0" />}
    </div>
  );

  const buttons = active && (
    <div className="flex flex-wrap items-center gap-2">
      {interactive && (control === "agent" || paused) && (
        <button type="button" data-testid="browser-take" disabled={busy} onClick={() => act("take")} className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50">Take control</button>
      )}
      {(inControl || paused) && (
        <button type="button" data-testid="browser-continue" disabled={busy} onClick={() => act("continue")} className="rounded-full bg-ok px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50">Continue</button>
      )}
      <button type="button" data-testid="browser-stop" disabled={busy || control === "stop"} onClick={() => act("stop")} className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-ink disabled:opacity-50">Stop</button>
    </div>
  );

  const pauseLine = paused || inControl ? (
    <p data-testid="browser-paused" className="mt-2 rounded-lg bg-accent/15 px-2 py-1.5 text-xs font-medium text-ink">{paused ? (job.control_reason || CHECK_LINE) : "Tap Continue when you're done"}</p>
  ) : null;

  const status = !active ? (
    <p data-testid="browser-final" className={`mt-2 text-xs ${job.status === "done" ? "text-ok" : "text-muted"}`}>
      {job.status === "done" ? "Finished" : job.status === "cancelled" ? "Stopped by you" : failureLine(job.error).slice(0, 320)}
    </p>
  ) : null;

  return (
    <>
      <div data-testid="browser-live" role="status" aria-live="polite" className="w-full rounded-[22px] rounded-bl-md border border-accent/30 bg-surface/85 px-3 py-3 backdrop-blur-xl sm:max-w-[92%] sm:px-4">
        <div className="flex items-center gap-2">
          {active ? (
            <span aria-hidden className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" /></span>
          ) : <span aria-hidden className={`inline-flex h-2.5 w-2.5 rounded-full ${job.status === "done" ? "bg-ok" : "bg-muted"}`} />}
          <p data-testid="browser-live-title" className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{title(job)}{host && <span className="text-muted"> · {host}</span>}</p>
        </div>
        {job.frame_url && <p data-testid="browser-live-url" className="mt-1 truncate text-[11px] text-muted">{job.frame_url}</p>}
        {pauseLine}
        {!expanded && view(false)}
        {status}
        {active && steps.length > 0 && (
          <ol data-testid="browser-live-steps" className="mt-2 space-y-1 text-xs text-ink-soft">
            {steps.slice(-4).map((s, n, arr) => {
              const now = n === arr.length - 1;
              return (
                <li key={`${n}-${s}`} data-testid={now ? "browser-live-step" : undefined} className="flex gap-2">
                  <span aria-hidden className={now ? "text-accent" : "text-ok"}>{now ? "●" : "✓"}</span><span className="min-w-0 flex-1 truncate">{s}</span>
                </li>
              );
            })}
          </ol>
        )}
        {buttons && <div className="mt-2">{buttons}</div>}
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
      {expanded && (
        <div data-testid="browser-live-full" className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center gap-2 bg-surface px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-sm text-ink">{title(job)}{job.frame_url ? <span className="text-muted"> · {job.frame_url}</span> : null}</p>
            {buttons}
            <button type="button" aria-label="Close" data-testid="browser-live-close" onClick={() => setExpanded(false)} className="rounded-full px-2 py-1 text-sm text-ink">✕</button>
          </div>
          {pauseLine && <div className="bg-surface px-3 pb-2">{pauseLine}</div>}
          {view(true)}
        </div>
      )}
    </>
  );
}
