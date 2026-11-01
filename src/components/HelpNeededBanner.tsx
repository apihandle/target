"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** A gold strip on every app page while a browser task waits for the owner to tap through a captcha. */
export default function HelpNeededBanner() {
  const path = usePathname();
  const [job, setJob] = useState<{ id: string; reason?: string } | null>(null);
  useEffect(() => {
    let on = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch("/api/browser-jobs/help-needed", { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => ({})) : {};
      if (on) setJob(j.jobs?.[0] ?? null);
    };
    check();
    const t = setInterval(check, 15000);
    document.addEventListener("visibilitychange", check);
    return () => { on = false; clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);
  if (!job || path?.startsWith("/app/settings/browser")) return null;
  return (
    <Link href={`/app/settings/browser?help=${job.id}`} data-testid="help-needed-banner"
      className="fixed left-1/2 top-3 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-full border border-accent bg-bg/90 px-4 py-2 text-sm text-ink shadow-lg backdrop-blur">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" /><path d="M9 12l2 2 4-4" /></svg>
      <span className="truncate">TARGET needs a quick tap from you{job.reason ? `: ${job.reason}` : ""}</span>
    </Link>
  );
}
