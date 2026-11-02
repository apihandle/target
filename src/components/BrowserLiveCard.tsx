"use client";
import { useEffect, useState } from "react";
import { isActive, stepText } from "@/lib/browserProgress";

type Job = { id: string; goal: string; start_url: string; status: string; log: string[]; error?: string | null };

/**
 * Live progress for a browser task in this chat: what the cloud browser is doing, step by step.
 * Polls while the reply is streaming or while a task is still running; disappears when it ends.
 */
export default function BrowserLiveCard({ conversationId, streaming, firstDelayMs = 3000 }: { conversationId?: string; streaming: boolean; firstDelayMs?: number }) {
  const [job, setJob] = useState<Job | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let active = false;
      try {
        const r = await fetch(`/api/browser-jobs/live?c=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as { job: Job | null }) : { job: null };
        if (stop) return;
        setJob(j.job);
        active = !!j.job && isActive(j.job.status);
        if (active) setSeen(true);
      } catch { /* try again next tick */ }
      if (!stop && (active || streaming)) timer = setTimeout(tick, 2000);
    };
    // First look after a short pause: browser tasks never finish in under a few seconds.
    timer = setTimeout(tick, firstDelayMs);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [conversationId, streaming, firstDelayMs]);

  if (!job || !isActive(job.status) || (!seen && !streaming)) return null;
  let host = "";
  try { host = new URL(job.start_url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  const steps = job.log.map(stepText).filter((s) => s !== "Finished");
  return (
    <div data-testid="browser-live" role="status" aria-live="polite" className="max-w-[92%] rounded-[22px] rounded-bl-md border border-accent/30 bg-surface/85 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span aria-hidden className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" /></span>
        <p className="text-sm font-medium text-ink">{job.status === "queued" ? "Starting the browser" : "Browser at work"}{host && <span className="text-muted"> · {host}</span>}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted">{job.goal}</p>
      {steps.length > 0 && (
        <ol data-testid="browser-live-steps" className="mt-2 space-y-1 text-xs text-ink-soft">
          {steps.slice(-6).map((s, n, arr) => (
            <li key={`${n}-${s}`} className="flex gap-2">
              <span aria-hidden className={n === arr.length - 1 ? "text-accent" : "text-ok"}>{n === arr.length - 1 ? "●" : "✓"}</span>
              <span className="min-w-0 flex-1 truncate">{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
