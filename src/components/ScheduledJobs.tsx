"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorNote } from "@/components/ui/EmptyState";
import { timeAgo } from "@/lib/activity";
import { WEEKDAYS, describeSchedule, type ScheduledJob } from "@/lib/schedule";

const STATUS_TEXT: Record<string, string> = {
  completed: "Last run finished", waiting_approval: "Last run is waiting for your approval", needs_connection: "Last run needs a connection",
  failed: "Last run failed", running: "Running now",
};

function fmt(iso: string | null, tz: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

export default function ScheduledJobs({ initial, projects, unavailable }: { initial: ScheduledJob[]; projects: { id: string; name: string }[]; unavailable?: boolean }) {
  const [jobs, setJobs] = useState(initial);
  const [form, setForm] = useState({ title: "", prompt: "", cadence: "once", weekday: "1", run_on: "", interval_hours: "2", time_of_day: "09:00", timezone: "Asia/Kolkata", project_id: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz) setForm((f) => ({ ...f, timezone: tz })); } catch { /* keep default */ }
    const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    setForm((f) => ({ ...f, run_on: f.run_on || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await fetch("/api/scheduled", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, weekday: form.cadence === "weekly" ? Number(form.weekday) : null, run_on: form.cadence === "once" ? form.run_on : null,
          interval_hours: form.cadence === "interval" ? Number(form.interval_hours) : null, project_id: form.project_id || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) { if (j.field) setErrors({ [j.field]: j.error }); else setError(j.error || "Could not save"); return; }
      setJobs((js) => [j.job, ...js]);
      setForm((f) => ({ ...f, title: "", prompt: "" }));
    } catch { setError("Could not save. Check your connection."); } finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const r = await fetch(`/api/scheduled/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error || "Could not update"); return; }
    setJobs((js) => js.map((x) => (x.id === id ? j.job : x)));
  }
  async function remove(id: string) {
    setError(null);
    const r = await fetch(`/api/scheduled/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { setError("Could not delete"); return; }
    setJobs((js) => js.filter((x) => x.id !== id));
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mt-8 space-y-8">
      {unavailable && <ErrorNote>Scheduled prompts aren&apos;t available yet: the database update for this feature hasn&apos;t been applied.</ErrorNote>}
      <Card>
        <form onSubmit={create} className="space-y-4" data-testid="schedule-form">
          <Field id="job-prompt" label="What should TARGET do?" error={errors.prompt}>
            <textarea value={form.prompt} onChange={set("prompt")} rows={3} maxLength={4000} placeholder="e.g. Remind me to call the bank, or summarize my unread GitHub notifications" className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="job-title" label="Name" optional error={errors.title}>
              <input value={form.title} onChange={set("title")} maxLength={120} placeholder="Morning GitHub digest" className={inputClass} />
            </Field>
            <Field id="job-project" label="Project" optional error={errors.project_id}>
              <select value={form.project_id} onChange={set("project_id")} className={inputClass}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field id="job-cadence" label="When" error={errors.cadence}>
              <select value={form.cadence} onChange={set("cadence")} className={inputClass} data-testid="schedule-cadence">
                <option value="once">Once (reminder)</option>
                <option value="interval">Every few hours</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </Field>
            {form.cadence === "once" && (
              <Field id="job-date" label="Date" error={errors.run_on}>
                <input type="date" value={form.run_on} onChange={set("run_on")} required className={inputClass} />
              </Field>
            )}
            {form.cadence === "interval" && (
              <Field id="job-every" label="Every" error={errors.interval_hours}>
                <select value={form.interval_hours} onChange={set("interval_hours")} className={inputClass}>
                  {[1, 2, 3, 4, 6, 8, 12, 24, 48, 72].map((n) => <option key={n} value={n}>{n === 1 ? "1 hour" : `${n} hours`}</option>)}
                </select>
              </Field>
            )}
            {form.cadence === "weekly" && (
              <Field id="job-weekday" label="Day" error={errors.weekday}>
                <select value={form.weekday} onChange={set("weekday")} className={inputClass}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
            )}
            <Field id="job-time" label={form.cadence === "interval" ? "Starting at" : "Time"} error={errors.time_of_day}>
              <input type="time" value={form.time_of_day} onChange={set("time_of_day")} required className={inputClass} />
            </Field>
            <Field id="job-tz" label="Timezone" error={errors.timezone}>
              <input value={form.timezone} onChange={set("timezone")} maxLength={64} className={inputClass} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Runs can start a few minutes after the time you pick. You&apos;ll get a phone notification if notifications are on.</p>
            <Button type="submit" variant="primary" disabled={busy || !form.prompt.trim() || unavailable} data-testid="schedule-create">{busy ? "Saving…" : "Schedule it"}</Button>
          </div>
        </form>
      </Card>
      {error && <ErrorNote>{error}</ErrorNote>}
      <section aria-label="Your scheduled prompts" className="space-y-3" data-testid="schedule-list">
        {jobs.length === 0 ? (
          <EmptyState title="No scheduled prompts yet">Create one above, like a daily digest or a weekly review.</EmptyState>
        ) : jobs.map((j) => (
          <Card key={j.id} data-testid="schedule-item">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium"><span className="truncate">{j.title}</span><Badge tone={j.status === "active" ? "accent" : "neutral"}>{j.status === "active" ? "Active" : j.status === "done" ? "Done" : "Paused"}</Badge></p>
                <p className="mt-1 text-xs text-muted">{describeSchedule(j)}</p>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-ink-soft">{j.prompt}</p>
                <p className="mt-2 text-xs text-muted-soft">
                  {j.status === "active" ? <>Next run: {fmt(j.next_run_at, j.timezone)}</> : j.status === "done" ? "Finished" : "Paused"}
                  {j.last_run_at && <> · {STATUS_TEXT[j.last_status ?? ""] ?? "Last run"} {timeAgo(j.last_run_at)}</>}
                  {j.last_task_id && <> · <a className="text-accent-strong underline" href="/app/activity?filter=tasks">See in Activity</a></>}
                </p>
                {j.last_status === "failed" && j.last_error && <p className="mt-1 text-xs text-danger">{j.last_error}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {j.status !== "done" && <Button size="sm" data-testid="schedule-toggle" onClick={() => patch(j.id, { status: j.status === "active" ? "paused" : "active" })}>{j.status === "active" ? "Pause" : "Resume"}</Button>}
                <Button size="sm" variant="danger" data-testid="schedule-delete" onClick={() => remove(j.id)}>Delete</Button>
              </div>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
