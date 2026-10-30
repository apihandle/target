"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { STATUS_LABEL, USER_SETTABLE, canTransition, type Task, type TaskStatus } from "@/lib/tasks";

export default function TaskList({ initial, projectId, allowAdd = true, emptyText }: { initial: Task[]; projectId?: string; allowAdd?: boolean; emptyText?: string }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [title, setTitle] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) { setFieldError("Give the task a title"); return; }
    setBusy(true); setFieldError(""); setError("");
    try {
      const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, ...(projectId ? { project_id: projectId } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (j.field === "title") setFieldError(j.error); else setError(j.error ?? "Couldn't add the task"); return; }
      setTasks((t) => [j.task, ...t]); setTitle("");
    } catch { setError("Network error. Try again."); }
    finally { setBusy(false); }
  }

  async function setStatus(t: Task, status: TaskStatus) {
    setError("");
    const r = await fetch(`/api/tasks/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setError(j.error ?? "Couldn't update the task"); return; }
    setTasks((ts) => ts.map((x) => (x.id === t.id ? j.task : x)));
  }

  async function remove(t: Task) {
    const r = await fetch(`/api/tasks/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { setError("Couldn't delete the task"); return; }
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
  }

  const chatHref = (t: Task) => `/app?t=${t.id}${t.project_id ? `&p=${t.project_id}` : ""}`;
  /** After connecting, the user returns to the task's chat and it resumes. */
  const connectHref = (t: Task) => {
    const back = t.conversation_id ? `/app?c=${t.conversation_id}&resume=${t.id}` : `/app?t=${t.id}`;
    return `/app/connectors?connect=${encodeURIComponent(t.needs_connector ?? "")}&return=${encodeURIComponent(back)}`;
  };

  return (
    <div data-testid="task-list">
      {allowAdd && (
        <form onSubmit={add} noValidate className="mb-4 flex items-start gap-2">
          <div className="flex-1">
            <Field id="new-task" label="New task" error={fieldError}>
              <input data-testid="task-title" value={title} onChange={(e) => { setTitle(e.target.value); setFieldError(""); }} maxLength={200} placeholder="e.g. Compare 3 hotels near Baga beach" className={inputClass} />
            </Field>
          </div>
          <Button type="submit" variant="primary" className="mt-[22px]" data-testid="task-add" disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
        </form>
      )}
      {error && <p role="alert" data-testid="task-error" className="mb-3 text-sm text-danger">{error}</p>}
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" testId="tasks-empty">{emptyText ?? "Add the first step above. TARGET can help you work on any task in chat."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {tasks.map((t) => (
            <li key={t.id} data-testid="task-item" data-status={t.status} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${t.status === "completed" || t.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>{t.title}</p>
                  <StatusBadge status={t.status} label={STATUS_LABEL[t.status]} />
                  {t.origin === "assistant" && <span className="text-[11px] text-muted-soft">from TARGET</span>}
                </div>
                {t.progress && <p className="mt-0.5 text-xs text-muted">{t.progress}</p>}
                {t.status === "failed" && t.error && <p data-testid="task-failure" className="mt-0.5 text-xs text-danger">{t.error}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.status === "waiting_approval" ? (
                  <Link href="/app/activity?filter=approvals" className="text-xs text-warn underline">Review approval</Link>
                ) : t.status === "needs_connection" && t.needs_connector ? (
                  <Link href={connectHref(t)} data-testid="task-connect" className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink hover:bg-accent-strong">Connect {t.needs_connector}</Link>
                ) : (
                  <>
                    <Link href={chatHref(t)} data-testid="task-chat" className="rounded-full px-2.5 py-1 text-xs text-accent-strong hover:bg-surface-2">
                      {t.status === "failed" ? "Retry with TARGET" : t.conversation_id ? "Continue in chat" : "Work on it with TARGET"}
                    </Link>
                    <label className="sr-only" htmlFor={`st-${t.id}`}>Status for {t.title}</label>
                    <select id={`st-${t.id}`} data-testid="task-status" value={USER_SETTABLE.includes(t.status) ? t.status : ""} onChange={(e) => e.target.value && setStatus(t, e.target.value as TaskStatus)}
                      className="h-8 rounded-full border border-line-strong bg-surface-2 px-2 text-xs text-ink">
                      {!USER_SETTABLE.includes(t.status) && <option value="">{STATUS_LABEL[t.status]}</option>}
                      {USER_SETTABLE.filter((s) => canTransition(t.status, s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </>
                )}
                <ConfirmButton label="Delete" question="Delete this task?" onConfirm={() => remove(t)} testId="task-delete" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
