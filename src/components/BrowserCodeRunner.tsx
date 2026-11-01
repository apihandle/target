"use client";

import { useEffect, useRef } from "react";
import { resultText, runInBrowser, type CodeJob } from "@/lib/browserCode";

/**
 * Picks up code runs TARGET queued for this browser (no worker online) and runs them in a sandboxed frame.
 * Polls every 2 seconds while a reply is streaming (the AI is waiting for the result); idle otherwise.
 */
export default function BrowserCodeRunner({ active }: { active: boolean }) {
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        const r = await fetch("/api/browser-jobs/browser-code", { cache: "no-store" });
        if (!r.ok) return;
        const { job } = (await r.json()) as { job: CodeJob | null };
        if (!job) return;
        const res = await runInBrowser(job);
        await fetch("/api/browser-jobs/browser-code", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: job.id, status: res.ok ? "done" : "failed", result: res.ok ? resultText(res) : res.output.slice(0, 5000) || null, error: res.error, files: res.files }),
        });
      } catch { /* offline or signed out: the server times the run out */ }
      finally { busy.current = false; }
    }
    // Only while a reply is streaming: that is when the AI may be waiting on a code run.
    if (!active) return () => { stopped = true; };
    const t = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(t); };
  }, [active]);

  return null;
}
