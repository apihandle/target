"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project, ProjectStatus } from "@/lib/projects";
import type { Task } from "@/lib/tasks";
import type { ActivityEvent } from "@/lib/activity";
import TaskList from "@/components/TaskList";
import ActivityTimeline from "@/components/ActivityTimeline";
import { Button, LinkButton } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

const STATUS_LABEL: Record<ProjectStatus, string> = { active: "Active", paused: "Paused", completed: "Completed", archived: "Archived" };

export default function ProjectDetail({ project, chats, tasks = [], events = [] }: { project: Project; chats: { id: string; title: string }[]; tasks?: Task[]; events?: ActivityEvent[] }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [instructions, setInstructions] = useState(project.instructions);
  const [status, setStatusText] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);
  const pStatus: ProjectStatus = project.status ?? "active";
  const dirty = name.trim() !== project.name || instructions.trim() !== project.instructions || description.trim() !== (project.description ?? "");

  async function patch(body: Record<string, unknown>, ok = "Saved") {
    setBusy(true); setStatusText(""); setNameError("");
    try {
      const r = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && j.field === "name") setNameError(j.error);
      setStatusText(r.ok ? ok : j.error ?? "Could not save");
      if (r.ok) router.refresh();
    } catch { setStatusText("Network error. Not saved."); }
    finally { setBusy(false); }
  }

  const save = () => {
    if (!name.trim()) { setNameError("Name is required"); return; }
    const body: Record<string, unknown> = { name, instructions };
    if (description.trim() !== (project.description ?? "")) body.description = description;
    return patch(body);
  };

  async function remove() {
    const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { router.push("/app/projects"); router.refresh(); } else setStatusText("Could not delete");
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-16 sm:px-6 md:pt-10">
      <Link href="/app/projects" className="text-xs text-muted hover:text-ink">← All projects</Link>
      {pStatus === "archived" && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm text-muted">
          This project is archived. It&apos;s hidden from your project list but nothing was deleted.
          <Button size="sm" variant="secondary" data-testid="pd-restore" disabled={busy} onClick={() => patch({ status: "active" }, "Restored")}>Restore</Button>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor="pd-name" className="sr-only">Project name</label>
          <input id="pd-name" data-testid="pd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!nameError || undefined}
            className="w-full rounded-lg bg-transparent text-2xl font-semibold tracking-tight outline-none hover:bg-surface focus:bg-surface sm:text-[28px]" />
          {nameError && <p role="alert" className="text-xs text-danger">{nameError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={pStatus} label={STATUS_LABEL[pStatus]} />
          {pStatus !== "archived" && (
            <>
              <label htmlFor="pd-status-select" className="sr-only">Project status</label>
              <select id="pd-status-select" data-testid="pd-status-select" value={pStatus} disabled={busy} onChange={(e) => patch({ status: e.target.value }, "Status updated")}
                className="h-8 rounded-full border border-line-strong bg-surface-2 px-2 text-xs text-ink">
                <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
              </select>
              <Button size="sm" variant="ghost" data-testid="pd-archive" disabled={busy} onClick={() => patch({ status: "archived" }, "Archived")}>Archive</Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field id="pd-description" label="Purpose" hint="What this project is for. TARGET uses it as context.">
          <textarea data-testid="pd-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} placeholder="e.g. Find a 2BHK in Patna under ₹15k by March" className={`${inputClass} resize-y`} />
        </Field>
        <Field id="pd-ins" label="Standing instructions" hint="Rules TARGET follows in every chat here.">
          <textarea data-testid="pd-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={4} placeholder="e.g. Budget is ₹30,000. Always answer in Hinglish." className={`${inputClass} resize-y`} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" data-testid="pd-save" onClick={save} disabled={!dirty || busy || !name.trim()}>Save</Button>
        {status && <span data-testid="pd-status" role="status" className="text-sm text-muted">{status}</span>}
        <span className="ml-auto"><ConfirmButton label="Delete project" question="Delete this project? Its chats and tasks are kept." testId="pd-delete" onConfirm={remove} /></span>
      </div>

      <section aria-labelledby="pd-tasks" className="mt-10">
        <h2 id="pd-tasks" className="mb-3 text-sm font-semibold">Tasks</h2>
        <TaskList initial={tasks} projectId={project.id} />
      </section>

      <section aria-labelledby="pd-chats-title" className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="pd-chats-title" className="text-sm font-semibold">Conversations</h2>
          <LinkButton href={`/app?p=${project.id}`} data-testid="pd-new-chat" size="sm" variant="secondary">+ New chat here</LinkButton>
        </div>
        <ul data-testid="pd-chats" className="space-y-1">
          {chats.length === 0 && <li><EmptyState title="No chats in this project yet">Start one and TARGET will work with this project&apos;s purpose and instructions.</EmptyState></li>}
          {chats.map((c) => (
            <li key={c.id}><Link href={`/app?c=${c.id}`} className="block truncate rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface">{c.title}</Link></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pd-activity" className="mt-10">
        <h2 id="pd-activity" className="mb-3 text-sm font-semibold">Recent activity</h2>
        <ActivityTimeline events={events} emptyText="Changes, tasks and approvals in this project will appear here." />
      </section>
    </div>
  );
}
