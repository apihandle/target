"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/projects";

export default function ProjectDetail({ project, chats }: { project: Project; chats: { id: string; title: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== project.name || instructions.trim() !== project.instructions;

  async function save() {
    setBusy(true); setStatus("");
    try {
      const r = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, instructions }) });
      const j = await r.json().catch(() => ({}));
      setStatus(r.ok ? "Saved" : j.error ?? "Could not save");
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete project "${project.name}"? Its chats stay in your chat list.`)) return;
    const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (r.ok) { router.push("/app/projects"); router.refresh(); } else setStatus("Could not delete");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:py-14">
      <Link href="/app/projects" className="text-xs text-white/50 hover:text-white">← All projects</Link>
      <input data-testid="pd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
        className="mt-3 w-full bg-transparent text-3xl font-extrabold tracking-tight outline-none" />
      <label className="mt-6 block text-xs uppercase tracking-wider text-white/40">Standing instructions</label>
      <textarea data-testid="pd-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={5}
        placeholder="e.g. Budget is ₹30,000. Always answer in Hinglish."
        className="mt-2 w-full resize-y rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm outline-none focus:border-white/40" />
      <div className="mt-2 flex items-center gap-3">
        <button data-testid="pd-save" onClick={save} disabled={!dirty || busy || !name.trim()} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-40">Save</button>
        {status && <span data-testid="pd-status" className="text-sm text-white/60">{status}</span>}
        <button data-testid="pd-delete" onClick={remove} className="ml-auto text-xs text-rose-400/80 hover:text-rose-400">Delete project</button>
      </div>
      <div className="mt-10 flex items-center justify-between">
        <h2 className="font-semibold">Chats</h2>
        <Link href={`/app?p=${project.id}`} data-testid="pd-new-chat" className="rounded-full border border-white/20 px-4 py-1.5 text-sm hover:bg-white/10">+ New chat here</Link>
      </div>
      <ul data-testid="pd-chats" className="mt-3 space-y-1">
        {chats.length === 0 && <li className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/40">No chats in this project yet.</li>}
        {chats.map((c) => (
          <li key={c.id}><Link href={`/app?c=${c.id}`} className="block truncate rounded-xl px-3 py-2 text-sm text-white/70 hover:bg-white/5">{c.title}</Link></li>
        ))}
      </ul>
    </div>
  );
}
