"use client";
import { useEffect, useRef, useState } from "react";
import PanelCard from "@/components/PanelCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { inputClass } from "@/components/ui/Field";
import { isStale, type Panel, type PanelKind } from "@/lib/panels";

type TypeDef = { kind: PanelKind; label: string; hint: string; field?: string; placeholder?: string; input?: string; group: "mine" | "live" };
const TYPES: TypeDef[] = [
  { kind: "weather", label: "Weather", hint: "Live forecast from open-meteo.com.", field: "city", placeholder: "City, e.g. Patna", group: "live" },
  { kind: "countdown", label: "Countdown", hint: "Days until (or since) a date.", field: "date", placeholder: "", input: "date", group: "mine" },
  { kind: "crypto", label: "Crypto price", hint: "Spot price from coinbase.com.", field: "symbol", placeholder: "Coin, e.g. BTC", group: "live" },
  { kind: "ai", label: "AI panel", hint: "AI-written text, refreshed daily. Can be wrong; not connected to any account.", field: "prompt", placeholder: "e.g. A motivating quote for today", group: "live" },
  { kind: "note", label: "Note", hint: "Text you keep in sight.", field: "text", placeholder: "Anything to keep in sight", group: "mine" },
  { kind: "list", label: "List", hint: "A checklist you maintain by hand.", group: "mine" },
  { kind: "tracker", label: "Task tracker", hint: "To do / doing / done, maintained by you.", group: "mine" },
  { kind: "goal", label: "Goal", hint: "A target number and progress you log.", field: "target", placeholder: "Target, e.g. 50", input: "number", group: "mine" },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "mine", label: "Tracked by you" },
  { id: "live", label: "Live data" },
] as const;

export default function PanelHome({ initial, name, title = "Panels" }: { initial: Panel[]; name?: string; title?: string }) {
  const [panels, setPanels] = useState<Panel[]>(initial);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<PanelKind>("weather");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [panelTitle, setPanelTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const auto = useRef(false);
  const t = TYPES.find((x) => x.kind === kind)!;
  const needsValue = !!t.field;

  async function refresh(id: string) {
    setRefreshing((r) => ({ ...r, [id]: true }));
    try {
      const r = await fetch(`/api/panels/${id}/refresh`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.panel) setPanels((ps) => ps.map((p) => (p.id === id ? j.panel : p)));
    } catch { /* card keeps its last data and error */ }
    finally { setRefreshing((r) => ({ ...r, [id]: false })); }
  }

  // Refresh anything stale once when the page opens.
  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    initial.filter((p) => isStale(p)).forEach((p) => refresh(p.id));
  }, [initial]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (needsValue && !value.trim()) { setError("This field is required"); return; }
    setBusy(true); setError("");
    try {
      const config: Record<string, string> = t.field ? { [t.field]: value } : {};
      if (kind === "goal" && unit.trim()) config.unit = unit;
      const body: Record<string, unknown> = { kind, title: panelTitle, config };
      if (description.trim()) body.description = description;
      const r = await fetch("/api/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Couldn't add panel"); return; }
      setPanels((ps) => [...ps, j.panel]); setValue(""); setPanelTitle(""); setDescription(""); setUnit(""); setAdding(false);
    } catch { setError("Network error. Try again."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    const prev = panels;
    setPanels((ps) => ps.filter((p) => p.id !== id));
    const r = await fetch(`/api/panels/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) setPanels(prev);
  }

  const shown = panels.filter((p) => filter === "all" || TYPES.find((x) => x.kind === p.kind)?.group === filter);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-16 sm:px-6 md:pt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{name ? `${title} · ${name}` : title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">Small, glanceable cards for what you want to keep an eye on. Lists, trackers, goals and notes are maintained by you; weather and prices come from the public sources shown on each card.</p>
        </div>
        <Button variant={adding ? "secondary" : "primary"} data-testid="panel-add-open" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Panel"}</Button>
      </div>

      {adding && (
        <form onSubmit={add} noValidate data-testid="panel-form" className="mt-6 rounded-xl2 border border-line bg-surface p-4 sm:p-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-soft">Type</legend>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((x) => (
                <button type="button" key={x.kind} data-testid={`type-${x.kind}`} aria-pressed={kind === x.kind} onClick={() => { setKind(x.kind); setValue(""); setError(""); }}
                  className={`rounded-full border px-3 py-1.5 text-sm ${kind === x.kind ? "border-accent bg-accent-subtle text-accent-strong" : "border-line-strong text-muted hover:bg-surface-2 hover:text-ink"}`}>{x.label}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{t.hint}</p>
          </fieldset>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {needsValue && (
              <div>
                <label htmlFor="panel-value" className="mb-1.5 block text-xs font-medium text-ink-soft">{kind === "goal" ? "Target" : kind === "countdown" ? "Date" : t.field === "city" ? "City" : t.field === "symbol" ? "Coin" : kind === "ai" ? "What should it show?" : "Text"}</label>
                <input id="panel-value" data-testid="panel-value" type={t.input ?? "text"} value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} placeholder={t.placeholder}
                  aria-invalid={!!error || undefined} aria-describedby={error ? "panel-form-error" : undefined} className={`${inputClass} [color-scheme:dark]`} />
              </div>
            )}
            {kind === "goal" && (
              <div>
                <label htmlFor="panel-unit" className="mb-1.5 block text-xs font-medium text-ink-soft">Unit <span className="font-normal text-muted-soft">(optional)</span></label>
                <input id="panel-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} placeholder="e.g. km, pages, ₹" className={inputClass} />
              </div>
            )}
            <div>
              <label htmlFor="panel-title" className="mb-1.5 block text-xs font-medium text-ink-soft">Title <span className="font-normal text-muted-soft">(optional)</span></label>
              <input id="panel-title" data-testid="panel-title" value={panelTitle} onChange={(e) => setPanelTitle(e.target.value)} maxLength={80} placeholder="Title" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="panel-desc" className="mb-1.5 block text-xs font-medium text-ink-soft">Description <span className="font-normal text-muted-soft">(optional)</span></label>
              <input id="panel-desc" data-testid="panel-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What is this for?" className={inputClass} />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            {error ? <p id="panel-form-error" role="alert" data-testid="panel-form-error" className="text-sm text-danger">{error}</p> : <span />}
            <Button type="submit" variant="primary" data-testid="panel-add" disabled={busy || (needsValue && !value.trim())}>{busy ? "Adding…" : "Add panel"}</Button>
          </div>
        </form>
      )}

      {panels.length > 0 && (
        <div role="tablist" aria-label="Filter panels" className="mt-8 flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} data-testid={`panel-filter-${f.id}`} onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-xs ${filter === f.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
              {f.label} <span className="text-muted-soft">{f.id === "all" ? panels.length : panels.filter((p) => TYPES.find((x) => x.kind === p.kind)?.group === f.id).length}</span>
            </button>
          ))}
        </div>
      )}

      <div data-testid="panel-grid" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {panels.length === 0 && !adding && (
          <div className="col-span-full">
            <EmptyState title="No panels yet" action={<Button variant="primary" onClick={() => setAdding(true)}>Create your first panel</Button>}>
              No panels yet. Start with a to-do list, a goal tracker or a countdown, or add weather or a price.
            </EmptyState>
          </div>
        )}
        {panels.length > 0 && shown.length === 0 && <p className="col-span-full text-sm text-muted">No panels match this filter.</p>}
        {shown.map((p) => (
          <PanelCard key={p.id} p={p} refreshing={refreshing[p.id]} onRefresh={() => refresh(p.id)} onDelete={() => remove(p.id)}
            onSaved={(np) => setPanels((ps) => ps.map((x) => (x.id === np.id ? np : x)))} />
        ))}
      </div>
    </div>
  );
}
