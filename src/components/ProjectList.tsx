"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/projects";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";

const STATUS_LABEL: Record<string, string> = { active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" };

export default function ProjectList({ initial, startOpen = false, archivedView = false, loadError = false }: { initial: (Project & { chats?: number; openTasks?: number })[]; startOpen?: boolean; archivedView?: boolean; loadError?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen || (initial.length === 0 && !archivedView));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) { setErrors({ name: "Give your project a name" }); return; }
    setBusy(true); setErrors({});
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, instructions }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErrors({ [j.field ?? "form"]: j.error ?? "Could not create" }); return; }
      router.push(`/app/projects/${j.project.id}`);
    } catch { setErrors({ form: "Network error. Try again." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-16 sm:px-6 md:pt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Projects</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">Give a longer effort, like a trip, a job search or a personal goal, its own space: purpose, tasks, chats and activity in one place.</p>
        </div>
        {!archivedView && <Button variant={open ? "secondary" : "primary"} aria-expanded={open} data-testid="project-new" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New project"}</Button>}
      </div>

      {loadError && <p role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">Projects couldn&apos;t load. If this is a new install, apply the migrations in supabase/migrations.</p>}

      {open && !archivedView && (
        <form onSubmit={create} noValidate className="mt-6 space-y-4 rounded-xl2 border border-line bg-surface p-4 sm:p-5">
          <Field id="project-name-field" label="Name" error={errors.name}>
            <input data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Goa trip in December" className={inputClass} autoFocus={startOpen} />
          </Field>
          <Field id="project-purpose" label="Purpose" optional hint="What are you trying to achieve? TARGET keeps this in mind." error={errors.description}>
            <textarea data-testid="project-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} placeholder="e.g. A relaxed 4-day beach trip for two, under ₹40,000" className={`${inputClass} resize-y`} />
          </Field>
          <Field id="project-ins" label="Standing instructions" optional hint="Rules TARGET should always follow in this project." error={errors.instructions}>
            <textarea data-testid="project-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={2} placeholder="e.g. Prefer trains over flights. Answer in Hinglish." className={`${inputClass} resize-y`} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            {errors.form ? <p role="alert" data-testid="project-error" className="text-sm text-danger">{errors.form}</p> : <span />}
            <Button type="submit" variant="primary" data-testid="project-create" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create project"}</Button>
          </div>
        </form>
      )}

      <nav aria-label="Project views" className="mt-8 flex gap-1">
        <Link href="/app/projects" aria-current={!archivedView ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-xs ${!archivedView ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>Current</Link>
        <Link href="/app/projects?view=archived" aria-current={archivedView ? "page" : undefined} data-testid="projects-archived" className={`rounded-full px-3 py-1.5 text-xs ${archivedView ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>Archived</Link>
      </nav>

      <div data-testid="project-grid" className="mt-4 grid gap-3 sm:grid-cols-2">
        {initial.length === 0 && (
          <div className="col-span-full">
            <EmptyState title={archivedView ? "No archived projects" : "No projects yet"}>
              {archivedView ? "Projects you archive are kept here and can be restored." : "Create one for anything that takes more than one conversation."}
            </EmptyState>
          </div>
        )}
        {initial.map((p) => (
          <Link key={p.id} href={`/app/projects/${p.id}`} data-testid="project-card" className="group rounded-xl2 border border-line bg-surface p-4 transition hover:border-line-strong hover:bg-surface-2">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-ink">📁 {p.name}</p>
              {p.status && <StatusBadge status={p.status} label={STATUS_LABEL[p.status] ?? p.status} />}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description || p.instructions || "No purpose written yet"}</p>
            <p className="mt-3 text-[11px] uppercase tracking-wider text-muted-soft">
              {p.chats !== undefined && <>{p.chats} chat{p.chats === 1 ? "" : "s"}</>}
              {p.openTasks !== undefined && <> · {p.openTasks} open task{p.openTasks === 1 ? "" : "s"}</>}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
