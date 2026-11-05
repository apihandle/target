"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { CATEGORY_LABEL, FEEDBACK_CATEGORIES, FEEDBACK_MAX, FEEDBACK_MIN, type FeedbackCategory } from "@/lib/feedback";

/** Simple feedback form: Bug / Idea / Other + a message. Sends the current app path with it (never the chat). */
export default function FeedbackForm({ pagePath, onSent, autoFocus }: { pagePath: string; onSent?: () => void; autoFocus?: boolean }) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const len = message.trim().length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (len < FEEDBACK_MIN) { setError("Please write a few words."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, category, page_path: pagePath }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setError(j.error ?? `Couldn't send it (HTTP ${r.status}).`); return; }
      setSent(true);
      setMessage("");
      onSent?.();
    } catch {
      setError("Network error. Your message is still here; try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" data-testid="feedback-sent" className="rounded-xl border border-ok/30 bg-ok-subtle px-3 py-3 text-sm text-ok">
        Thanks! Your feedback reached the TARGET team.
        <button type="button" className="ml-2 underline" onClick={() => setSent(false)}>Send more</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="feedback-form" noValidate>
      <div role="radiogroup" aria-label="Type" className="flex gap-1.5">
        {FEEDBACK_CATEGORIES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} data-testid={`feedback-cat-${c}`}
            className={`h-8 rounded-full border px-3 text-xs font-medium ${category === c ? "border-accent/40 bg-accent-subtle text-accent-strong" : "border-line bg-surface/80 text-muted hover:text-ink"}`}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <Field id="feedback-message" label={category === "bug" ? "What went wrong?" : category === "idea" ? "What would help?" : "Your message"} error={error ?? undefined}
        hint={`${len}/${FEEDBACK_MAX}. Please don't include passwords or card numbers.`}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX))} rows={5} maxLength={FEEDBACK_MAX} autoFocus={autoFocus}
          className={`${inputClass} min-h-[110px] resize-y`} placeholder={category === "bug" ? "What you did, and what happened instead" : "Tell us in a few words"} data-testid="feedback-input" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy || len < FEEDBACK_MIN} data-testid="feedback-submit">{busy ? "Sending…" : "Send feedback"}</Button>
      </div>
    </form>
  );
}
