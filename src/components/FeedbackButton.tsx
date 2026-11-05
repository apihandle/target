"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FeedbackForm from "@/components/FeedbackForm";

/** Small "Send feedback" link for the app sidebar; opens the form in a sheet (bottom sheet on phones). */
export default function FeedbackButton({ onOpen }: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  // The page it was opened on (read at click time, so the sidebar needs no router hooks).
  const [path, setPath] = useState("/app");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => { setPath(window.location.pathname || "/app"); onOpen?.(); setOpen(true); }} data-testid="feedback-open"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface hover:text-ink">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1z" /><path d="M9 10h6M9 13h4" /></svg>
        Send feedback
      </button>
      {/* Portaled to <body>: the sidebar is transformed (drawer on phones), which would trap a fixed overlay inside it. */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-testid="feedback-dialog"
            className="w-full max-w-md rounded-2xl border border-line-strong bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="feedback-title" className="text-base font-semibold text-ink">Send feedback</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <FeedbackForm pagePath={path} autoFocus />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
