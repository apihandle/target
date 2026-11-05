/**
 * Tiny SVG charts for /admin (no chart library, nothing added to other routes' bundles).
 * Colours come from TARGET's tokens via currentColor / Tailwind classes.
 */

export function SparkBars({ values, className = "text-accent", label }: { values: number[]; className?: string; label: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(values.length, 1);
  const w = 64, h = 28, gap = 1.5;
  const bw = (w - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className={`shrink-0 ${className}`}>
      {values.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * h);
        return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={0.8} fill="currentColor" opacity={0.35 + 0.65 * ((i + 1) / n)} />;
      })}
    </svg>
  );
}

export type LinePoint = { t: string; a: number; b?: number };

/** Responsive line chart: series a (solid, glowing) and optional series b (dashed). Hover a point for its value. */
export function LineChart({ points, labelA, labelB, formatT, height = 200 }: { points: LinePoint[]; labelA: string; labelB?: string; formatT: (iso: string) => string; height?: number }) {
  const W = 640, H = height, L = 34, R = 10, T = 12, B = 26;
  const max = Math.max(1, ...points.map((p) => Math.max(p.a, p.b ?? 0)));
  const nice = niceMax(max);
  const x = (i: number) => L + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  const path = (k: "a" | "b") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y((k === "a" ? p.a : p.b ?? 0)).toFixed(1)}`).join(" ");
  const area = `${path("a")} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, nice / 2, nice];
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${labelA}${labelB ? ` and ${labelB}` : ""} over time`}>
      <defs>
        <linearGradient id="admin-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#5fd08a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#5fd08a" stopOpacity="0" />
        </linearGradient>
        <filter id="admin-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#1a272d" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted-soft" fontSize={10}>{fmtNum(t)}</text>
        </g>
      ))}
      {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
        <text key={p.t} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-muted-soft" fontSize={10}>{formatT(p.t)}</text>
      ))}
      {points.length > 0 && <path d={area} fill="url(#admin-area)" />}
      {labelB && points.length > 0 && <path d={path("b")} fill="none" stroke="#e6c487" strokeWidth={1.6} strokeDasharray="4 4" opacity={0.85} />}
      {points.length > 0 && <path d={path("a")} fill="none" stroke="#5fd08a" strokeWidth={2.2} filter="url(#admin-glow)" strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={`pt-${p.t}`}>
          <circle cx={x(i)} cy={y(p.a)} r={points.length > 30 ? 0 : 2.6} fill="#5fd08a" />
          <rect x={x(i) - 6} y={T} width={12} height={H - T - B} fill="transparent">
            <title>{`${formatT(p.t)}: ${p.a} ${labelA}${labelB ? `, ${p.b ?? 0} ${labelB}` : ""}`}</title>
          </rect>
        </g>
      ))}
    </svg>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(Math.round(n * 10) / 10));

export type DonutSlice = { label: string; value: number; color: string };

export function Donut({ slices, centre, sub, size = 168 }: { slices: DonutSlice[]; centre: string; sub: string; size?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${centre} ${sub}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`} className="shrink-0">
      <circle cx={60} cy={60} r={r} fill="none" stroke="#18252b" strokeWidth={14} />
      {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
        const len = (s.value / total) * c;
        const el = <circle key={s.label} cx={60} cy={60} r={r} fill="none" stroke={s.color} strokeWidth={14} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{`${s.label}: ${s.value}`}</title></circle>;
        offset += len;
        return el;
      })}
      <text x={60} y={58} textAnchor="middle" className="fill-ink" fontSize={17} fontWeight={600}>{centre}</text>
      <text x={60} y={74} textAnchor="middle" className="fill-muted" fontSize={8.5}>{sub}</text>
    </svg>
  );
}

export function PctBar({ pct, className = "bg-accent" }: { pct: number; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <span className={`block h-full rounded-full ${className}`} style={{ width: `${w}%` }} />
    </span>
  );
}

export type ShareItem = { label: string; count: number; pct: number; note?: string };

/** Labelled share bars ("label · count · %"), first bar in gold. Used for provider / model / feature splits. */
export function ShareBars({ items, testId, barClass = "bg-sky-accent/80" }: { items: ShareItem[]; testId?: string; barClass?: string }) {
  return (
    <ul className="space-y-2.5" data-testid={testId}>
      {items.map((v, i) => (
        <li key={v.label} data-testid={testId ? `${testId}-row` : undefined}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-ink-soft" title={v.label}>{v.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{v.count.toLocaleString("en-IN")} · {v.pct.toFixed(1)}%{v.note ? <span className="ml-1.5 text-danger/90">{v.note}</span> : null}</span>
          </div>
          <div className="mt-1"><PctBar pct={v.pct} className={i === 0 ? "bg-accent" : barClass} /></div>
        </li>
      ))}
    </ul>
  );
}
