"use client";
import { useEffect, useRef, useState } from "react";
import { Button, type Size } from "@/components/ui/Button";

/** Two-step destructive button: first press asks, second confirms. Keyboard and screen-reader friendly. */
export function ConfirmButton({ label, confirmLabel = "Yes, delete", question, onConfirm, size = "sm", testId, disabled }: {
  label: string; confirmLabel?: string; question: string; onConfirm: () => void | Promise<void>; size?: Size; testId?: string; disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) yes.current?.focus(); }, [asking]);
  if (!asking) return <Button size={size} variant="ghost" className="text-danger/90 hover:text-danger" data-testid={testId} disabled={disabled} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-2 rounded-full border border-danger/30 bg-danger-subtle py-1 pl-3 pr-1 text-xs text-danger">
      <span>{question}</span>
      <Button ref={yes} size="sm" variant="danger" data-testid={testId ? `${testId}-confirm` : undefined} disabled={busy}
        onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsking(false); } }}>{busy ? "Working…" : confirmLabel}</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)} onKeyDown={(e) => e.key === "Escape" && setAsking(false)}>Cancel</Button>
    </span>
  );
}
