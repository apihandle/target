"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { daysUntil, goalTotal, summarizePanel, weatherLabel, type GoalEntry, type ListItem, type Panel, type TrackerItem } from "@/lib/panels";
import { timeAgo } from "@/lib/activity";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { inputClass } from "@/components/ui/Field";

const SOURCE: Partial<Record<Panel["kind"], string>> = { weather: "open-meteo.com", crypto: "coinbase.com", ai: "AI-written; may be inaccurate" };
const KIND_LABEL: Record<Panel["kind"], string> = { weather: "Weather", countdown: "Countdown", crypto: "Price", ai: "AI summary", note: "Note", list: "List", tracker: "Task tracker", goal: "Goal" };

const newId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 36);

/** Structured items editor for list / tracker / goal panels. Saves through PATCH /api/panels/:id (server-validated). */
function ItemsEditor({ p, onSaved, readOnly }: { p: Panel; onSaved?: (p: Panel) => void; readOnly?: boolean }) {
  const [items, setItems] = useState(p.items ?? []);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(next: typeof items) {
    const prev = items;
    setItems(next); setError(""); setSaving(true);
    try {
      const r = await fetch(`/api/panels/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setItems(prev); setError(j.error ?? "Couldn't save"); return; }
      setItems(j.panel.items ?? next); onSaved?.(j.panel);
    } catch { setItems(prev); setError("Network error. Not saved."); }
    finally { setSaving(false); }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (p.kind === "goal") {
      const amount = Number(v);
      if (!isFinite(amount)) { setError("Enter a number"); return; }
      save([...(items as GoalEntry[]), { id: newId(), amount, note: note.trim(), date: new Date().toISOString() }]);
      setNote("");
    } else if (p.kind === "list") save([...(items as ListItem[]), { id: newId(), text: v, done: false }]);
    else save([...(items as TrackerItem[]), { id: newId(), text: v, status: "todo" }]);
    setDraft("");
  }

  const remove = (id: string) => save(items.filter((i) => i.id !== id) as typeof items);

  return (
    <div>
      {p.kind === "goal" && (() => {
        const total = goalTotal(items as GoalEntry[]); const target = Number(p.config.target) || 1;
        const pct = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
        return (
          <div data-testid="goal-body">
            <p className="text-2xl font-semibold">{summarizePanel({ ...p, items })}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Goal progress">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
              {(items as GoalEntry[]).slice().reverse().slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>{e.amount > 0 ? "+" : ""}{e.amount} {p.config.unit} {e.note && `· ${e.note}`} <span className="text-muted-soft">· {timeAgo(e.date)}</span></span>
                  {!readOnly && <button aria-label="Remove entry" onClick={() => remove(e.id)} className="px-1 hover:text-ink">×</button>}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {p.kind !== "goal" && (
        <>
          <p className="mb-2 text-xs text-muted" data-testid="panel-summary">{summarizePanel({ ...p, items })}</p>
          <ul data-testid={`${p.kind}-body`} className="max-h-56 space-y-1 overflow-y-auto">
            {items.length === 0 && <li className="text-sm text-muted-soft">Nothing here yet.</li>}
            {p.kind === "list" && (items as ListItem[]).map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" id={`i-${i.id}`} checked={i.done} disabled={readOnly || saving} onChange={() => save((items as ListItem[]).map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} className="h-4 w-4 accent-[#f2994a]" />
                <label htmlFor={`i-${i.id}`} className={`flex-1 ${i.done ? "text-muted line-through" : "text-ink-soft"}`}>{i.text}</label>
                {!readOnly && <button aria-label={`Remove ${i.text}`} onClick={() => remove(i.id)} className="px-1 text-muted-soft hover:text-ink">×</button>}
              </li>
            ))}
            {p.kind === "tracker" && (items as TrackerItem[]).map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <span className={`flex-1 ${i.status === "done" ? "text-muted line-through" : "text-ink-soft"}`}>{i.text}</span>
                <label className="sr-only" htmlFor={`s-${i.id}`}>Status of {i.text}</label>
                <select id={`s-${i.id}`} value={i.status} disabled={readOnly || saving} onChange={(e) => save((items as TrackerItem[]).map((x) => (x.id === i.id ? { ...x, status: e.target.value as TrackerItem["status"] } : x)))}
                  className="h-7 rounded-full border border-line-strong bg-surface-2 px-2 text-xs text-ink">
                  <option value="todo">To do</option><option value="doing">Doing</option><option value="done">Done</option>
                </select>
                {!readOnly && <button aria-label={`Remove ${i.text}`} onClick={() => remove(i.id)} className="px-1 text-muted-soft hover:text-ink">×</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && (
        <form onSubmit={add} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor={`add-${p.id}`}>{p.kind === "goal" ? "Amount to log" : "New item"}</label>
          <input id={`add-${p.id}`} data-testid="panel-item-input" value={draft} onChange={(e) => setDraft(e.target.value)} inputMode={p.kind === "goal" ? "decimal" : undefined}
            placeholder={p.kind === "goal" ? `Log progress${p.config.unit ? ` (${p.config.unit})` : ""}` : "Add an item"} className={`${inputClass} h-8 py-1`} maxLength={200} />
          {p.kind === "goal" && <input aria-label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className={`${inputClass} h-8 w-24 py-1`} maxLength={120} />}
          <button data-testid="panel-item-add" disabled={!draft.trim() || saving} className="h-8 rounded-full bg-surface-3 px-3 text-xs font-medium text-ink disabled:opacity-40">Add</button>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PanelBody({ p, onSaved, readOnly }: { p: Panel; onSaved?: (p: Panel) => void; readOnly?: boolean }) {
  const d = (p.data ?? {}) as Record<string, number & string>;
  switch (p.kind) {
    case "weather": {
      if (p.data == null || d.temp === undefined) return null;
      const [label, icon] = weatherLabel(Number(d.code));
      return (
        <div data-testid="weather-body">
          <div className="flex items-end gap-3"><span className="text-4xl" aria-hidden>{icon}</span><span className="text-4xl font-semibold">{Math.round(d.temp)}°</span></div>
          <p className="mt-1 text-sm text-ink-soft">{label} · H {Math.round(d.high)}° L {Math.round(d.low)}°{d.rain != null ? ` · ${d.rain}% rain` : ""}</p>
          <p className="mt-1 text-xs text-muted">{d.place}</p>
        </div>
      );
    }
    case "crypto": {
      if (p.data == null || d.amount === undefined) return null;
      const fmt = new Intl.NumberFormat(d.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: String(d.currency), maximumFractionDigits: Number(d.amount) < 10 ? 4 : 0 });
      return <p data-testid="crypto-body" className="text-3xl font-semibold">{fmt.format(Number(d.amount))}</p>;
    }
    case "countdown": {
      const n = daysUntil(p.config.date);
      return (
        <div data-testid="countdown-body">
          <p className="text-4xl font-semibold">{Math.abs(n)}</p>
          <p className="text-sm text-ink-soft">{n === 0 ? "It's today!" : n > 0 ? `day${n === 1 ? "" : "s"} to go` : `day${n === -1 ? "" : "s"} ago`}</p>
          <p className="mt-1 text-xs text-muted">{new Date(p.config.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
      );
    }
    case "ai":
      return p.data && d.text ? <div data-testid="ai-body" className="prose-target text-sm text-ink-soft"><ReactMarkdown>{String(d.text)}</ReactMarkdown></div> : null;
    case "note":
      return <p data-testid="note-body" className="whitespace-pre-wrap text-sm text-ink-soft">{p.config.text}</p>;
    case "list": case "tracker": case "goal":
      return <ItemsEditor p={p} onSaved={onSaved} readOnly={readOnly} />;
  }
}

export default function PanelCard({ p, refreshing, onRefresh, onDelete, onSaved, compact }: { p: Panel; refreshing?: boolean; onRefresh?: () => void; onDelete?: () => void; onSaved?: (p: Panel) => void; compact?: boolean }) {
  const live = p.kind === "weather" || p.kind === "crypto" || p.kind === "ai";
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description ?? "");
  const [err, setErr] = useState("");

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch(`/api/panels/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setErr(j.error ?? "Couldn't save"); return; }
    onSaved?.(j.panel); setEditing(false);
  }

  return (
    <article data-testid="panel" data-kind={p.kind} aria-label={p.title} className="flex flex-col rounded-xl2 border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-soft">{KIND_LABEL[p.kind]}</p>
          <h3 className="truncate text-sm font-semibold text-ink">{p.title}</h3>
          {p.description && !compact && <p className="mt-0.5 text-xs text-muted">{p.description}</p>}
        </div>
        {!compact && (
          <div className="flex shrink-0 items-center gap-1">
            {live && onRefresh && <button data-testid="panel-refresh" aria-label={`Refresh ${p.title}`} onClick={onRefresh} disabled={refreshing} className={`rounded-full px-1.5 text-muted hover:text-ink ${refreshing ? "animate-spin" : ""}`}>↻</button>}
            {onSaved && <button data-testid="panel-edit" aria-label={`Edit ${p.title}`} aria-expanded={editing} onClick={() => setEditing((x) => !x)} className="rounded-full px-1.5 text-xs text-muted hover:text-ink">Edit</button>}
            {onDelete && <ConfirmButton label="Remove" question="Remove panel?" confirmLabel="Remove" onConfirm={onDelete} testId="panel-delete" />}
          </div>
        )}
      </div>
      {editing && (
        <form onSubmit={saveMeta} className="mb-3 space-y-2 rounded-lg border border-line p-3">
          <label className="block text-xs text-ink-soft" htmlFor={`t-${p.id}`}>Title</label>
          <input id={`t-${p.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={inputClass} />
          <label className="block text-xs text-ink-soft" htmlFor={`d-${p.id}`}>Description</label>
          <input id={`d-${p.id}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className={inputClass} />
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2"><button className="h-8 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink">Save</button><button type="button" onClick={() => setEditing(false)} className="h-8 px-2 text-xs text-muted">Cancel</button></div>
        </form>
      )}
      <div className="flex-1">
        {compact && (p.kind === "list" || p.kind === "tracker" || p.kind === "goal")
          ? <p className="text-sm text-ink-soft" data-testid="panel-summary">{summarizePanel(p)}</p>
          : <PanelBody p={p} onSaved={onSaved} />}
      </div>
      {p.error && <p data-testid="panel-error" className="mt-2 text-xs text-danger">{p.error}{onRefresh ? " · try refresh" : ""}</p>}
      {live && p.refreshed_at && <p className="mt-3 text-[11px] text-muted-soft">Updated {timeAgo(p.refreshed_at)} · {SOURCE[p.kind]}</p>}
    </article>
  );
}
