"use client";
import ReactMarkdown from "react-markdown";
import { daysUntil, weatherLabel, type Panel } from "@/lib/panels";

function ago(iso?: string | null) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function PanelBody({ p }: { p: Panel }) {
  const d = (p.data ?? {}) as Record<string, number & string>;
  switch (p.kind) {
    case "weather": {
      if (p.data == null) return null;
      const [label, icon] = weatherLabel(Number(d.code));
      return (
        <div data-testid="weather-body">
          <div className="flex items-end gap-3"><span className="text-4xl">{icon}</span><span className="text-4xl font-extrabold">{Math.round(d.temp)}°</span></div>
          <p className="mt-1 text-sm text-white/70">{label} · H {Math.round(d.high)}° L {Math.round(d.low)}°{d.rain != null ? ` · ${d.rain}% rain` : ""}</p>
          <p className="mt-1 text-xs text-white/40">{d.place}</p>
        </div>
      );
    }
    case "crypto": {
      if (p.data == null) return null;
      const fmt = new Intl.NumberFormat(d.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: String(d.currency), maximumFractionDigits: Number(d.amount) < 10 ? 4 : 0 });
      return <p data-testid="crypto-body" className="text-3xl font-extrabold">{fmt.format(Number(d.amount))}</p>;
    }
    case "countdown": {
      const n = daysUntil(p.config.date);
      return (
        <div data-testid="countdown-body">
          <p className="text-4xl font-extrabold">{Math.abs(n)}</p>
          <p className="text-sm text-white/60">{n === 0 ? "It's today!" : n > 0 ? `day${n === 1 ? "" : "s"} to go` : `day${n === -1 ? "" : "s"} ago`}</p>
          <p className="mt-1 text-xs text-white/40">{new Date(p.config.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
      );
    }
    case "ai":
      return p.data ? <div data-testid="ai-body" className="prose prose-invert prose-sm max-w-none text-white/80 [&_ul]:pl-4 [&_ul]:list-disc"><ReactMarkdown>{String(d.text)}</ReactMarkdown></div> : null;
    case "note":
      return <p data-testid="note-body" className="whitespace-pre-wrap text-sm text-white/80">{p.config.text}</p>;
  }
}

export default function PanelCard({ p, refreshing, onRefresh, onDelete }: { p: Panel; refreshing?: boolean; onRefresh?: () => void; onDelete?: () => void }) {
  const live = p.kind === "weather" || p.kind === "crypto" || p.kind === "ai";
  return (
    <div data-testid="panel" data-kind={p.kind} className="flex flex-col rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">{p.title}</h3>
        <div className="flex shrink-0 gap-1">
          {live && onRefresh && <button data-testid="panel-refresh" aria-label="Refresh" onClick={onRefresh} disabled={refreshing} className={`rounded-full px-1.5 text-white/40 hover:text-white ${refreshing ? "animate-spin" : ""}`}>↻</button>}
          {onDelete && <button data-testid="panel-delete" aria-label="Remove" onClick={onDelete} className="rounded-full px-1.5 text-white/40 hover:text-white">✕</button>}
        </div>
      </div>
      <div className="flex-1"><PanelBody p={p} /></div>
      {p.error && <p data-testid="panel-error" className="mt-2 text-xs text-rose-400">{p.error}</p>}
      {live && p.refreshed_at && <p className="mt-3 text-[11px] text-white/30">Updated {ago(p.refreshed_at)}</p>}
    </div>
  );
}
