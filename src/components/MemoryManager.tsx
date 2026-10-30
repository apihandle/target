"use client";
import { useState } from "react";
import type { Memory } from "@/lib/memory";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { inputClass } from "@/components/ui/Field";

export default function MemoryManager({ initial, enabled: initialEnabled = true, embedded = false }: { initial: Memory[]; enabled?: boolean; embedded?: boolean }) {
  const [items, setItems] = useState<Memory[]>(initial);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

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
    } catch { setError("Network error. Not saved."); }
    finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    setError("");
    const r = await fetch(`/api/memories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editText }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setError(j.error ?? "Could not save"); return; }
    setItems((x) => x.map((m) => (m.id === id ? j.memory : m))); setEditing(null);
  }

  async function remove(id: string) {
    const prev = items;
    setItems((x) => x.filter((m) => m.id !== id)); setError("");
    const r = await fetch(`/api/memories/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { setItems(prev); setError("Could not delete"); }
  }

  async function clearAll() {
    const prev = items; setItems([]);
    const r = await fetch("/api/memories", { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { setItems(prev); setError("Could not clear"); }
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next); setError("");
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory_enabled: next }) }).catch(() => null);
    if (!r || !r.ok) { setEnabled(!next); setError("Couldn't change the memory setting"); }
  }

  return (
    <div className={embedded ? "" : "mx-auto w-full max-w-2xl px-4 py-10 md:py-14"}>
      {!embedded && <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="max-w-md">
          <p id="mem-toggle-label" className="text-sm font-medium">Remember things about me</p>
          <p className="mt-0.5 text-xs text-muted">
            {enabled ? "On: TARGET learns lasting facts from your chats (or when you say “remember that…”) and uses them to personalize replies."
              : "Off: TARGET won’t save new memories or use saved ones in chats. Existing memories stay until you delete them."}
          </p>
        </div>
        <button role="switch" aria-checked={enabled} aria-labelledby="mem-toggle-label" data-testid="memory-toggle" onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-accent" : "bg-surface-3"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      <form onSubmit={add} className="mt-4 flex gap-2">
        <label htmlFor="memory-input" className="sr-only">Add a memory</label>
        <input id="memory-input" data-testid="memory-input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
          placeholder="e.g. I'm vegetarian" className={`${inputClass} flex-1`} />
        <Button type="submit" variant="primary" data-testid="memory-add" disabled={busy || !draft.trim()}>Add</Button>
      </form>
      {error && <p role="alert" data-testid="memory-error" className="mt-3 text-sm text-danger">{error}</p>}
      <ul data-testid="memory-list" className="mt-4 space-y-2">
        {items.length === 0 && <li className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">Nothing remembered yet.</li>}
        {items.map((m) => (
          <li key={m.id} data-testid="memory-item" className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            {editing === m.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); saveEdit(m.id); }}>
                <label htmlFor={`edit-${m.id}`} className="sr-only">Edit memory</label>
                <input id={`edit-${m.id}`} autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={500} className={`${inputClass} flex-1`} />
                <Button type="submit" size="sm" variant="primary">Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <div>
                  <p className="text-sm">{m.content}</p>
                  {m.source && <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-soft">{m.source === "manual" ? "added by you" : m.source === "explicit" ? "you asked" : "learned in chat"}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button data-testid="memory-edit" aria-label={`Edit: ${m.content}`} onClick={() => { setEditing(m.id); setEditText(m.content); }} className="rounded-full px-2 text-xs text-muted hover:bg-surface-2 hover:text-ink">Edit</button>
                  <button data-testid="memory-delete" aria-label={`Forget: ${m.content}`} onClick={() => remove(m.id)} className="rounded-full px-2 text-muted hover:bg-surface-2 hover:text-ink">✕</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && <div className="mt-4"><ConfirmButton label="Forget everything" question="Delete every memory?" confirmLabel="Forget all" testId="memory-clear" onConfirm={clearAll} /></div>}
    </div>
  );
}
