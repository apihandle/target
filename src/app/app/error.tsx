"use client";
import { useEffect } from "react";
import Link from "next/link";
import { sendErrorReport } from "@/lib/clientErrors";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { sendErrorReport(error, { digest: error.digest }); }, [error]);
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-bg px-6 text-center text-ink" data-testid="app-error">
      <div className="max-w-sm">
        <p aria-hidden className="font-script text-5xl text-accent">Target</p>
        <h1 className="mt-4 font-display text-3xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">This page hit an error. It has been reported, and your chats are safe.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-strong">Try again</button>
          <Link href="/app" className="rounded-full border border-line-strong px-5 py-2 text-sm text-ink-soft hover:text-ink">Go to chat</Link>
        </div>
      </div>
    </div>
  );
}
