"use client";
import { useEffect, useRef, useState } from "react";
import PanelCard from "@/components/PanelCard";
import { isStale, type Panel, type PanelKind } from "@/lib/panels";

const TYPES: { kind: PanelKind; label: string; field: string; placeholder: string; input?: string }[] = [
  { kind: "weather", label: "🌤️ Weather", field: "city", placeholder: "City, e.g. Patna" },
  { kind: "countdown", label: "⏳ Countdown", field: "date", placeholder: "", input: "date" },
  { kind: "crypto", label: "₿ Crypto price", field: "symbol", placeholder: "Coin, e.g. BTC" },
  { kind: "ai", label: "✨ AI panel", field: "prompt", placeholder: "e.g. A motivating quote for today" },
  { kind: "note", label: "📝 Note", field: "text", placeholder: "Anything to keep in sight" },
];

export default function PanelHome({ initial, name }: { initial: Panel[]; name?: string }) {
  const [panels, setPanels] = useState<Panel[]>(initial);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<PanelKind>("weather");
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const auto = useRef(false);
  const t = TYPES.find((x) => x.kind === kind)!;

  async function refresh(id: string) {
    setRefreshing((r) => ({ ...r, [id]: true }));
    try {
      const r = await fetch(`/api/panels/${id}/refresh`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.panel) setPanels((ps) => ps.map((p) => (p.id === id ? j.panel : p)));
    } finally { setRefreshing((r) => ({ ...r, [id]: false })); }
  }

  // Refresh anything stale once when Home opens.
  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    initial.filter((p) => isStale(p)).forEach((p) => refresh(p.id));
  }, [initial]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const config: Record<string, string> = { [t.field]: value };
      const r = await fetch("/api/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, title, config }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Couldn't add panel"); return; }
      setPanels((ps) => [...ps, j.panel]); setValue(""); setTitle(""); setAdding(false);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    const prev = panels;
    setPanels((ps) => ps.filter((p) => p.id !== id));
    const r = await fetch(`/api/panels/${id}`, { method: "DELETE" });
    if (!r.ok) setPanels(prev);
  }

  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{greet}{name ? `, ${name}` : ""}</h1>
          <p className="mt-1 text-sm text-white/50">Your Home: panels that keep themselves up to date.</p>
        </div>
        <button data-testid="panel-add-open" onClick={() => setAdding((a) => !a)} className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">{adding ? "Close" : "+ Panel"}</button>
      </div>

      {adding && (
        <form onSubmit={add} data-testid="panel-form" className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap gap-2">
            {TYPES.map((x) => (
              <button type="button" key={x.kind} data-testid={`type-${x.kind}`} onClick={() => { setKind(x.kind); setValue(""); setError(""); }}
                className={`rounded-full border px-3 py-1.5 text-sm ${kind === x.kind ? "border-white bg-white text-black" : "border-white/15 text-white/70 hover:bg-white/10"}`}>{x.label}</button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input data-testid="panel-value" type={t.input ?? "text"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.placeholder}
              className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40 [color-scheme:dark]" />
            <input data-testid="panel-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Title (optional)"
              className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40" />
            <button data-testid="panel-add" disabled={busy || !value.trim()} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy ? "Adding…" : "Add"}</button>
          </div>
          {error && <p data-testid="panel-form-error" className="mt-2 text-sm text-rose-400">{error}</p>}
        </form>
      )}

      <div data-testid="panel-grid" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {panels.length === 0 && !adding && (
          <button onClick={() => setAdding(true)} className="col-span-full rounded-3xl border border-dashed border-white/15 p-10 text-center text-sm text-white/40 hover:bg-white/[0.03]">
            No panels yet. Add weather, a countdown, a price, or an AI panel.
          </button>
        )}
        {panels.map((p) => (
          <PanelCard key={p.id} p={p} refreshing={refreshing[p.id]} onRefresh={() => refresh(p.id)} onDelete={() => remove(p.id)} />
        ))}
      </div>
    </div>
  );
}
