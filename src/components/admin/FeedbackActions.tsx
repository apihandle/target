"use client";
import { useState } from "react";
import ConfirmAction from "@/components/admin/ConfirmAction";
import { inputClass } from "@/components/ui/Field";
import { FEEDBACK_STATUSES, NOTE_MAX, STATUS_LABEL, type FeedbackStatus } from "@/lib/feedback";

/** Status + internal note for one feedback item. Saving goes through the confirm dialog and the audit log. */
export default function FeedbackActions({ id, status, note }: { id: string; status: FeedbackStatus; note: string | null }) {
  const [s, setS] = useState<FeedbackStatus>(status);
  const [n, setN] = useState(note ?? "");
  const changed = s !== status || n.trim() !== (note ?? "").trim();
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-start" data-testid="feedback-actions">
      <label className="sr-only" htmlFor={`fb-status-${id}`}>Status</label>
      <select id={`fb-status-${id}`} value={s} onChange={(e) => setS(e.target.value as FeedbackStatus)} data-testid="feedback-status"
        className={`${inputClass} h-9 py-1 sm:w-32`}>
        {FEEDBACK_STATUSES.map((v) => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
      </select>
      <label className="sr-only" htmlFor={`fb-note-${id}`}>Admin note (only admins see it)</label>
      <textarea id={`fb-note-${id}`} value={n} onChange={(e) => setN(e.target.value.slice(0, NOTE_MAX))} rows={1} maxLength={NOTE_MAX} placeholder="Admin note (only admins see it)"
        data-testid="feedback-note" className={`${inputClass} min-h-[36px] flex-1 resize-y py-1.5`} />
      <ConfirmAction label="Save" title="Update this feedback?" testId={`feedback-save-${id}`} disabled={!changed}
        message={<>Status: <strong>{STATUS_LABEL[s]}</strong>{n.trim() !== (note ?? "").trim() ? <>; the admin note will be {n.trim() ? "saved" : "cleared"}</> : null}. The user only sees the status, never the note.</>}
        confirmLabel="Save" url={`/api/admin/feedback/${id}`} getBody={() => ({ status: s, note: n })} successText="Saved." />
    </div>
  );
}
