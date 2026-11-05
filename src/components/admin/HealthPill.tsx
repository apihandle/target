"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type State = { state: "checking" } | { state: "ok" } | { state: "degraded"; down: string[] } | { state: "error" };

/** "System OK" / "Degraded" from the live health checks (server caches the summary for 60 s). */
export default function HealthPill() {
  const [s, setS] = useState<State>({ state: "checking" });
  useEffect(() => {
    let live = true;
    fetch("/api/admin/health?summary=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { state: "ok" | "degraded"; down?: string[] }) => { if (live) setS(j.state === "ok" ? { state: "ok" } : { state: "degraded", down: j.down ?? [] }); })
      .catch(() => { if (live) setS({ state: "error" }); });
    return () => { live = false; };
  }, []);
  const cls = s.state === "ok" ? "border-ok/40 bg-ok-subtle text-ok" : s.state === "degraded" ? "border-danger/40 bg-danger-subtle text-danger" : "border-line-strong bg-surface-2 text-muted";
  const dot = s.state === "ok" ? "bg-ok shadow-[0_0_8px_#5fd08a]" : s.state === "degraded" ? "bg-danger shadow-[0_0_8px_#f47c7c]" : "bg-muted-soft";
  const label = s.state === "ok" ? "System OK" : s.state === "degraded" ? "Degraded" : s.state === "checking" ? "Checking…" : "Status unknown";
  const title = s.state === "degraded" && s.down.length ? `Down: ${s.down.join(", ")}` : label;
  return (
    <Link href="/admin/health" title={title} data-testid="health-pill" data-state={s.state} className={`inline-flex h-9 items-center gap-2 rounded-full border px-2.5 text-xs font-medium sm:px-3 ${cls}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </Link>
  );
}
