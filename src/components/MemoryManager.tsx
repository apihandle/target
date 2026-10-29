"use client";
import { useState } from "react";
import type { Memory } from "@/lib/memory";

export default function MemoryManager({ initial }: { initial: Memory[] }) {
  const [items, setItems] = useState<Memory[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Could not save"); return; }
      setItems((x) => [j.memory, ...x]); setDraft("");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    const prev = items;
    setItems((x) => x.filter((m) => m.id !== id)); setError("");
    const r = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (!r.ok) { setItems(prev); setError("Could not delete"); }
  }

  async function clearAll() {
    if (!items.length || !window.confirm("Forget everything TARGET remembers about you?")) return;
    const prev = items; setItems([]);
    const r = await fetch("/api/memories", { method: "DELETE" });
    if (!r.ok) { setItems(prev); setError("Could not clear"); }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">Memory</h1>
      <p className="mt-2 text-sm text-white/60">
        What TARGET remembers about you. It learns from your chats, or say &ldquo;remember that…&rdquo;. Everything here is yours to edit or delete.
      </p>
      <form onSubmit={add} className="mt-6 flex gap-2">
        <input data-testid="memory-input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
          placeholder="e.g. I'm vegetarian" className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-white/40" />
        <button data-testid="memory-add" disabled={busy || !draft.trim()} className="rounded-full bg-white px-5 text-sm font-semibold text-black disabled:opacity-40">Add</button>
      </form>
      {error && <p data-testid="memory-error" className="mt-3 text-sm text-rose-400">{error}</p>}
      <ul data-testid="memory-list" className="mt-6 space-y-2">
        {items.length === 0 && <li className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/40">Nothing yet. Chat with TARGET and it will remember what matters.</li>}
        {items.map((m) => (
          <li key={m.id} data-testid="memory-item" className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div>
              <p className="text-sm">{m.content}</p>
              {m.source && <p className="mt-1 text-[11px] uppercase tracking-wider text-white/35">{m.source === "manual" ? "added by you" : m.source === "explicit" ? "you asked" : "learned in chat"}</p>}
            </div>
            <button data-testid="memory-delete" aria-label="Forget" onClick={() => remove(m.id)} className="shrink-0 rounded-full px-2 text-white/40 hover:bg-white/10 hover:text-white">✕</button>
          </li>
        ))}
      </ul>
      {items.length > 0 && <button data-testid="memory-clear" onClick={clearAll} className="mt-6 text-xs text-white/40 underline hover:text-white">Forget everything</button>}
    </div>
  );
}
