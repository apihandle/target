import Link from "next/link";
import { daysUntil, goalTotal, weatherLabel, type GoalEntry, type ListItem, type Panel, type TrackerItem } from "@/lib/panels";

/** The glanceable reading of a panel: one big value and one short line. */
export function panelGlance(p: Panel): { value: string; sub: string; pct?: number; text?: string } {
  const d = (p.data ?? {}) as Record<string, unknown>;
  const items = p.items ?? [];
  switch (p.kind) {
    case "weather": {
      if (p.data == null || d.temp === undefined) return { value: "—", sub: p.error ? "Couldn't update" : "Not updated yet" };
      const [label] = weatherLabel(Number(d.code));
      return { value: `${Math.round(Number(d.temp))}°`, sub: [label, d.place].filter(Boolean).join(" · ") };
    }
    case "crypto": {
      if (p.data == null || d.amount === undefined) return { value: "—", sub: p.error ? "Couldn't update" : "Not updated yet" };
      const amount = Number(d.amount);
      const fmt = new Intl.NumberFormat(d.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: String(d.currency || "USD"), maximumFractionDigits: amount < 10 ? 4 : 0 });
      return { value: fmt.format(amount), sub: p.config.symbol || "Price" };
    }
    case "countdown": {
      if (!p.config.date) return { value: "—", sub: "No date" };
      const n = daysUntil(p.config.date);
      return { value: String(Math.abs(n)), sub: n === 0 ? "Today" : n > 0 ? `day${n === 1 ? "" : "s"} to go` : `day${n === -1 ? "" : "s"} ago` };
    }
    case "goal": {
      const total = goalTotal(items as GoalEntry[]);
      const target = Number(p.config.target) || 0;
      const pct = target ? Math.max(0, Math.min(100, Math.round((total / target) * 100))) : 0;
      const n = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
      return { value: `${pct}%`, sub: `${n.format(total)} of ${n.format(target)}${p.config.unit ? ` ${p.config.unit}` : ""}`, pct };
    }
    case "list": {
      const l = items as ListItem[];
      return l.length ? { value: `${l.filter((i) => i.done).length}/${l.length}`, sub: "done" } : { value: "0", sub: "items" };
    }
    case "tracker": {
      const t = items as TrackerItem[];
      const c = (s: TrackerItem["status"]) => t.filter((i) => i.status === s).length;
      return t.length ? { value: String(c("todo") + c("doing")), sub: `open · ${c("done")} done` } : { value: "0", sub: "tasks" };
    }
    case "note":
      return { value: "", sub: "", text: p.config.text || "Empty note" };
    case "ai": {
      const text = typeof d.text === "string" ? d.text.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim() : "";
      return { value: "", sub: "", text: text || (p.error ? "Couldn't update" : "Not updated yet") };
    }
  }
  return { value: "—", sub: "" };
}

const TILE = "flex h-32 flex-col rounded-2xl border p-3.5 transition-colors sm:h-36 sm:p-4";

/** One fixed-height panel tile for the Home grid; opens the Panels page. */
export default function PanelTile({ p }: { p: Panel }) {
  const g = panelGlance(p);
  return (
    <Link href="/app/panels" data-testid="home-panel" data-kind={p.kind} aria-label={p.title}
      className={`${TILE} border-line bg-surface/80 hover:border-line-strong hover:bg-surface-2/80`}>
      <h3 className="truncate text-[13px] font-medium text-muted">{p.title}</h3>
      {g.pct !== undefined && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.pct} aria-label="Goal progress">
          <div className="h-full rounded-full bg-accent" style={{ width: `${g.pct}%` }} />
        </div>
      )}
      {g.text !== undefined ? (
        <p className="mt-2 line-clamp-3 text-sm leading-snug text-ink-soft sm:line-clamp-4">{g.text}</p>
      ) : (
        <div className="mt-auto min-w-0">
          <p className="truncate text-[26px] font-semibold leading-none tracking-tight text-ink sm:text-3xl">{g.value}</p>
          {g.sub && <p className="mt-1.5 truncate text-xs text-muted">{g.sub}</p>}
        </div>
      )}
    </Link>
  );
}

/** The "+" tile at the end of the grid. */
export function AddPanelTile({ labelled }: { labelled?: boolean }) {
  return (
    <Link href="/app/panels?new=1" data-testid="home-add-panel" aria-label="Add a panel"
      className={`${TILE} items-center justify-center gap-1.5 border-dashed border-line-strong text-muted hover:border-accent/50 hover:text-ink`}>
      <span aria-hidden className="text-2xl leading-none">+</span>
      {labelled && <span className="text-sm">Add a panel</span>}
    </Link>
  );
}
