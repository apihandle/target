"use client";
import { useEffect, useRef, useState } from "react";
import { BUILTIN_TEMPLATES, type PromptTemplate } from "@/lib/templates";

/**
 * Prompt templates popover: built-ins plus the user's saved ones. Picking a template only fills the
 * composer (nothing is sent). Users can save the current text as a template, edit or delete their own.
 */
export default function TemplatesMenu({ current, onPick, disabled }: { current: string; onPick: (prompt: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<PromptTemplate[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; title: string; prompt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [open]);

  async function load() {
    try {
      const r = await fetch("/api/templates");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load templates");
      setMine(j.templates ?? []);
    } catch (e) { setMine([]); setError(e instanceof Error ? e.message : "Could not load templates"); }
  }
  function toggle() { const next = !open; setOpen(next); setError(null); if (next && mine === null) load(); }

  async function save() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(editing.id ? `/api/templates/${editing.id}` : "/api/templates", {
        method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: editing.title, prompt: editing.prompt }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      setMine((m) => editing.id ? (m ?? []).map((t) => (t.id === editing.id ? j.template : t)) : [j.template, ...(m ?? [])]);
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setError(null);
    const r = await fetch(`/api/templates/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setMine((m) => (m ?? []).filter((t) => t.id !== id));
    else setError("Could not delete the template");
  }
  const pick = (p: string) => { onPick(p); setOpen(false); };
  const item = "flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-ink-soft hover:bg-surface-2 hover:text-ink";

  return (
    <div ref={box} className="relative">
      <button type="button" data-testid="templates-btn" onClick={toggle} disabled={disabled} aria-expanded={open} aria-haspopup="dialog"
        className="h-8 rounded-full border border-line-strong bg-surface px-3 text-xs font-semibold text-muted hover:text-ink disabled:opacity-40">
        Templates
      </button>
      {open && (
        <div role="dialog" aria-label="Prompt templates" data-testid="templates-menu"
          className="absolute bottom-10 left-0 z-20 max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line-strong bg-surface p-2 shadow-card">
          <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-soft">Built-in</p>
          {BUILTIN_TEMPLATES.map((t) => (
            <div key={t.id} className="flex"><button type="button" data-testid="template-item" className={item} onClick={() => pick(t.prompt)}>{t.title}</button></div>
          ))}
          <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-soft">Yours</p>
          {mine === null && <p className="px-2 py-1 text-xs text-muted">Loading…</p>}
          {mine?.length === 0 && <p className="px-2 py-1 text-xs text-muted">No saved templates yet.</p>}
          {mine?.map((t) => (
            <div key={t.id} className="group flex items-center gap-1">
              <button type="button" data-testid="template-item" className={item} onClick={() => pick(t.prompt)}>{t.title}</button>
              <button type="button" aria-label={`Edit ${t.title}`} onClick={() => setEditing({ id: t.id, title: t.title, prompt: t.prompt })} className="rounded px-1.5 text-xs text-muted hover:text-ink">✎</button>
              <button type="button" aria-label={`Delete ${t.title}`} onClick={() => remove(t.id)} className="rounded px-1.5 text-xs text-muted hover:text-danger">✕</button>
            </div>
          ))}
          {editing ? (
            <div className="mt-2 space-y-2 border-t border-line px-1 pt-2">
              <input aria-label="Template name" data-testid="template-title" value={editing.title} maxLength={60} placeholder="Name"
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="w-full rounded-lg border border-line-strong bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
              <textarea aria-label="Template text" data-testid="template-prompt" value={editing.prompt} maxLength={4000} rows={4}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                className="w-full resize-y rounded-lg border border-line-strong bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="h-8 rounded-full px-3 text-xs text-muted hover:text-ink">Cancel</button>
                <button type="button" data-testid="template-save" disabled={busy || !editing.title.trim() || !editing.prompt.trim()} onClick={save}
                  className="h-8 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-40">{editing.id ? "Save changes" : "Save template"}</button>
              </div>
            </div>
          ) : (
            <button type="button" data-testid="template-new" onClick={() => setEditing({ title: "", prompt: current })}
              className="mt-2 w-full rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-xs text-muted hover:text-ink">
              + {current.trim() ? "Save current message as a template" : "New template"}
            </button>
          )}
          {error && <p role="alert" className="px-2 pt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
