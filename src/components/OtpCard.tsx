"use client";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

type Job = { status: string; result: string | null; error: string | null };

/** The one-time code a site sent while TARGET signs in. Sent straight to that sign-in job, then shows how it ended. */
export default function OtpCard({ job, site }: { job: string; site: string }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "waiting" | "over">("idle");
  const [info, setInfo] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function check(): Promise<Job | null> {
    const r = await fetch(`/api/browser-jobs/${job}`).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    return (j?.job as Job | undefined) ?? null;
  }
  function poll(left = 60) {
    timer.current = setTimeout(async () => {
      const j = await check();
      if (j && ["done", "failed", "cancelled"].includes(j.status)) { setInfo(j); setState("over"); return; }
      if (left > 0) poll(left - 1);
    }, 3000);
  }
  useEffect(() => {
    check().then((j) => { if (j && ["done", "failed", "cancelled"].includes(j.status)) { setInfo(j); setState("over"); } });
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("busy"); setError("");
    const r = await fetch(`/api/browser-jobs/${job}/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState(r.status === 409 ? "over" : "idle"); setError(j.error ?? "Couldn't send the code"); return; }
    setCode(""); setState("waiting"); poll();
  }

  const box = "not-prose mt-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-xs";
  if (state === "over") return (
    <section data-testid="otp-card" data-state="over" className={box}>
      <p className="font-medium text-ink-soft">{info?.status === "done" ? `✓ Signed in to ${site}` : info ? `Sign-in to ${site} stopped` : error || `This sign-in to ${site} has ended`}</p>
      {info?.status === "done" && info.result && <p className="mt-1 whitespace-pre-wrap text-muted">{info.result.slice(0, 600)}</p>}
      {info && info.status !== "done" && info.error && <p className="mt-1 text-muted">{info.error.slice(0, 200)}</p>}
    </section>
  );
  if (state === "waiting") return <section data-testid="otp-card" data-state="waiting" className={box}><p className="text-muted">Code sent. Finishing the sign-in to {site}…</p></section>;
  return (
    <form onSubmit={send} autoComplete="off" data-testid="otp-card" className="not-prose mt-3 space-y-2 rounded-xl border border-accent/40 bg-surface p-4 text-sm">
      <p className="font-medium text-ink">Code sent by {site}</p>
      <div className="flex gap-2">
        <input aria-label="One-time code" data-testid="otp-input" value={code} onChange={(e) => setCode(e.target.value)} required inputMode="numeric" maxLength={12} autoComplete="one-time-code" placeholder="123456" className={inputClass} />
        <button type="submit" data-testid="otp-send" disabled={state === "busy"} className={buttonClass("primary", "sm")}>{state === "busy" ? "…" : "Continue"}</button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
