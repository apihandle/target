"use client";
import { useState } from "react";
import { LineChart } from "@/components/admin/charts";

type Range = "3h" | "24h" | "7d" | "30d";
type Bucket = { t: string; messages: number; users: number };
const RANGES: { v: Range; label: string }[] = [{ v: "3h", label: "3h" }, { v: "24h", label: "24h" }, { v: "7d", label: "7d" }, { v: "30d", label: "30d" }];

function formatFor(range: Range) {
  return (iso: string) => {
    const d = new Date(iso);
    const opts: Intl.DateTimeFormatOptions = range === "3h" || range === "24h" ? { hour: "numeric", minute: "2-digit" } : range === "7d" ? { weekday: "short", hour: "numeric" } : { day: "numeric", month: "short" };
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
  };
}

/** Activity line chart with a range picker; the first range comes server-rendered, others load from /api/admin/stats/activity. */
export default function ActivityChart({ initial, initialRange = "24h" }: { initial: { buckets: Bucket[]; error: boolean; capped: boolean }; initialRange?: Range }) {
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  const load = async (r: Range) => {
    setRange(r);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/stats/activity?range=${r}`, { cache: "no-store" });
      const j = (await res.json()) as { buckets?: Bucket[]; capped?: boolean };
      setData({ buckets: j.buckets ?? [], error: !res.ok, capped: !!j.capped });
    } catch { setData({ buckets: [], error: true, capped: false }); }
    finally { setLoading(false); }
  };
  const pick = (r: Range) => { if (r !== range && !loading) void load(r); };

  const totalMsgs = data.buckets.reduce((a, b) => a + b.messages, 0);
  const peakUsers = Math.max(0, ...data.buckets.map((b) => b.users));
  return (
    <section className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" aria-labelledby="act-title" data-testid="activity-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="act-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden className="h-2 w-2 rounded-full bg-ok shadow-[0_0_8px_#5fd08a]" />
          Activity <span className="font-normal text-ok">({totalMsgs.toLocaleString("en-IN")} messages)</span>
        </h2>
        <div role="group" aria-label="Range" className="flex rounded-full border border-line bg-bg/60 p-0.5">
          {RANGES.map((r) => (
            <button key={r.v} type="button" onClick={() => pick(r.v)} aria-pressed={range === r.v} data-testid={`range-${r.v}`}
              className={`h-7 min-w-[40px] rounded-full px-2.5 text-xs font-medium transition ${range === r.v ? "bg-accent-subtle text-accent-strong" : "text-muted hover:text-ink"}`}>{r.label}</button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded bg-ok" />Messages</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded border-t border-dashed border-accent" />Active users (peak {peakUsers})</span>
        {data.capped && <span className="text-warn">First 20,000 messages counted</span>}
      </div>
      <div className={`mt-2 transition-opacity ${loading ? "opacity-40" : ""}`} aria-busy={loading}>
        {data.error ? (
          <p role="alert" className="py-12 text-center text-sm text-danger">Couldn&apos;t load activity. <button type="button" className="underline" onClick={() => void load(range)}>Retry</button></p>
        ) : totalMsgs === 0 && !loading ? (
          <p className="py-12 text-center text-sm text-muted" data-testid="activity-empty">No messages in this range yet.</p>
        ) : (
          <LineChart points={data.buckets.map((b) => ({ t: b.t, a: b.messages, b: b.users }))} labelA="messages" labelB="active users" formatT={formatFor(range)} />
        )}
      </div>
    </section>
  );
}
