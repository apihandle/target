"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import type { QuickAction } from "@/lib/settings";

export default function QuickActionsEditor({ initial, hidden: initialHidden }: { initial: QuickAction[]; hidden: string[] }) {
  const [items, setItems] = useState<QuickAction[]>(initial);
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<QuickAction>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(""); setError("");
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Couldn't save"); return; }
      setItems(j.settings.quick_actions); setHidden(j.settings.hidden_quick_actions); setMsg(ok);
    } catch { setError("Network error. Not saved."); }
    finally { setBusy(false); }
  }

  return (
    <div data-testid="qa-editor" className="space-y-3">
      {items.map((q, i) => (
        <div key={q.id + i} data-testid="qa-row" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[180px_1fr_auto]">
          <div>
            <label htmlFor={`qa-label-${i}`} className="mb-1 block text-[11px] text-muted">Label</label>
            <input id={`qa-label-${i}`} value={q.label} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`qa-prompt-${i}`} className="mb-1 block text-[11px] text-muted">{q.target === "new_project" ? "Opens the new-project form" : "Chat text"}</label>
            <input id={`qa-prompt-${i}`} value={q.prompt} disabled={q.target === "new_project"} maxLength={500} onChange={(e) => update(i, { prompt: e.target.value })} className={inputClass} />
          </div>
          <div className="flex items-end gap-1">
            {hidden.includes(q.id) && <Button size="sm" variant="ghost" onClick={() => save({ hidden_quick_actions: hidden.filter((h) => h !== q.id) }, "Shown on Home again")}>Show</Button>}
            <Button size="sm" variant="ghost" aria-label={`Remove ${q.label}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={items.length >= 8} onClick={() => setItems((xs) => [...xs, { id: `custom-${Date.now().toString(36)}`, label: "", prompt: "", target: "chat" }])}>+ Add quick action</Button>
        <Button size="sm" variant="primary" data-testid="qa-save" disabled={busy} onClick={() => save({ quick_actions: items }, "Saved")}>Save</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => save({ quick_actions: null, hidden_quick_actions: [] }, "Reset to defaults")}>Reset to defaults</Button>
        {msg && <span role="status" className="text-xs text-ok">{msg}</span>}
        {error && <span role="alert" data-testid="qa-error" className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
