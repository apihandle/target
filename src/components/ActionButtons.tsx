"use client";
import { useState } from "react";
import { actionLabel, calendarUrl, mapUrl, type Action } from "@/lib/actions";

type State = "idle" | "busy" | "done" | "error";

export default function ActionButtons({ actions }: { actions: Action[] }) {
  const [state, setState] = useState<Record<number, State>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});
  if (!actions.length) return null;

  async function run(i: number, a: Action) {
    const set = (st: State, m = "") => { setState((x) => ({ ...x, [i]: st })); setMsg((x) => ({ ...x, [i]: m })); };
    if (a.type === "copy") {
      try { await navigator.clipboard.writeText(a.text); set("done", "Copied"); } catch { set("error", "Couldn't copy"); }
      return;
    }
    if (a.type !== "memory" && a.type !== "panel") return;
    set("busy");
    const r = a.type === "memory"
      ? await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: a.content }) })
      : await fetch("/api/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: a.kind, title: a.title, config: a.config }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) set("done", a.type === "memory" ? "Saved to memory" : "Added to Home");
    else if (r.status === 409) set("done", "Already remembered");
    else set("error", j.error ?? "Failed");
  }

  const cls = "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50";
  return (
    <div data-testid="actions" className="mt-3 flex flex-wrap gap-2">
      {actions.map((a, i) => {
        const st = state[i] ?? "idle";
        const label = st === "done" || st === "error" ? (st === "done" ? "✓ " : "⚠ ") + msg[i] : st === "busy" ? "…" : actionLabel(a);
        if (a.type === "calendar" || a.type === "map" || a.type === "link") {
          const href = a.type === "calendar" ? calendarUrl(a) : a.type === "map" ? mapUrl(a.query) : a.url;
          return <a key={i} data-testid="action" data-type={a.type} href={href} target="_blank" rel="noopener noreferrer" className={cls}>{label}</a>;
        }
        return <button key={i} data-testid="action" data-type={a.type} disabled={st === "busy" || st === "done"} onClick={() => run(i, a)} className={cls}>{label}</button>;
      })}
    </div>
  );
}
