"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/projects";

export default function ProjectList({ initial }: { initial: (Project & { chats?: number })[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, instructions }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Could not create"); return; }
      router.push(`/app/projects/${j.project.id}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Projects</h1>
      <p className="mt-2 text-sm text-white/60">Give a big goal its own space: standing instructions plus every chat about it, in one place.</p>
      <form onSubmit={create} className="mt-6 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <input data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Project name, e.g. Goa trip"
          className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40" />
        <textarea data-testid="project-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} rows={3}
          placeholder="Instructions TARGET should always follow here (optional)"
          className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40" />
        <div className="flex items-center justify-between">
          {error ? <p data-testid="project-error" className="text-sm text-rose-400">{error}</p> : <span />}
          <button data-testid="project-create" disabled={busy || !name.trim()} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-40">Create project</button>
        </div>
      </form>
      <div data-testid="project-grid" className="mt-8 grid gap-3 sm:grid-cols-2">
        {initial.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/40">No projects yet.</p>}
        {initial.map((p) => (
          <Link key={p.id} href={`/app/projects/${p.id}`} data-testid="project-card" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.07]">
            <p className="font-semibold">📁 {p.name}</p>
            <p className="mt-1 line-clamp-2 text-xs text-white/50">{p.instructions || "No instructions"}</p>
            {p.chats !== undefined && <p className="mt-3 text-[11px] uppercase tracking-wider text-white/35">{p.chats} chat{p.chats === 1 ? "" : "s"}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
