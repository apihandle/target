"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, type Variant } from "@/components/ui/Button";

export type ConfirmActionProps = {
  label: string;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  url: string;
  body?: Record<string, unknown>;
  /** Called with the parsed body before posting; return a string to block with that message. */
  validate?: () => string | null;
  getBody?: () => Record<string, unknown>;
  variant?: Variant;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
  /** A plain string from server components; a function only from client components. */
  successText?: string | ((res: Record<string, unknown>) => string);
};

/**
 * Every admin write goes through this: a button that opens a confirm dialog, then POSTs JSON with confirm: true
 * (the server refuses writes without it), shows the result, and refreshes the page data.
 */
export default function ConfirmAction({ label, title, message, confirmLabel, url, body, getBody, validate, variant = "secondary", danger, disabled, testId, successText }: ConfirmActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    yes.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const start = () => {
    const problem = validate?.() ?? null;
    if (problem) { setNote({ ok: false, text: problem }); return; }
    setNote(null);
    setOpen(true);
  };

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(getBody ? getBody() : body ?? {}), confirm: true }) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : `Failed (HTTP ${res.status})` });
      else { setNote({ ok: true, text: typeof successText === "function" ? successText(j) : successText ?? "Done." }); router.refresh(); }
    } catch {
      setNote({ ok: false, text: "Network error. Nothing was confirmed; check the page and try again." });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant={variant} disabled={disabled || busy} onClick={start} data-testid={testId}>{busy ? "Working…" : label}</Button>
      {note && <span role="status" data-testid={testId ? `${testId}-note` : undefined} className={`text-xs ${note.ok ? "text-ok" : "text-danger"}`}>{note.text}</span>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" data-testid={testId ? `${testId}-dialog` : "confirm-dialog"}
            className="w-full max-w-sm rounded-2xl border border-line-strong bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title" className="text-base font-semibold text-ink">{title}</h2>
            {message && <div className="mt-2 text-sm leading-relaxed text-muted">{message}</div>}
            <p className="mt-2 text-xs text-muted-soft">This is recorded in the admin audit log.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button ref={yes} variant={danger ? "danger" : "primary"} onClick={run} disabled={busy} data-testid={testId ? `${testId}-confirm` : undefined}>{busy ? "Working…" : confirmLabel}</Button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
