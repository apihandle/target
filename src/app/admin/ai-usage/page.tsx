import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { AI_PROVIDER_LABEL, AI_RANGES, cleanAiFilters, isAiRange, loadAiCalls, loadAiStats, type AiRange, type Share } from "@/lib/server/adminAiUsage";
import { pageFrom } from "@/lib/adminConfig";
import { Badge } from "@/components/ui/Badge";
import { LineChart, ShareBars } from "@/components/admin/charts";
import { Chips, duration, Empty, fmt, hrefWith, LoadError, num, Pager, SectionHeading, sp, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<AiRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
const FEATURE_LABEL: Record<string, string> = {
  chat: "Chat", chat_quick: "Chat (quick)", scheduled: "Scheduled", browser: "Browser steps", video: "Video", research: "Research",
  memory: "Memory", suggestions: "Suggestion buttons", proactive: "For-you scan", panels: "Panels", other: "Other",
};
const pctText = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`);
const ms = (v: number | null) => (v == null ? "—" : duration(v));

function formatFor(range: AiRange) {
  return (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...(range === "24h" ? { hour: "numeric", minute: "2-digit" } : range === "7d" ? { weekday: "short", hour: "numeric" } : { day: "numeric", month: "short" }) } as Intl.DateTimeFormatOptions);
}

function Card({ title, action, children, testId, className = "" }: { title: ReactNode; action?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section data-testid={testId} className={`rounded-2xl border border-line bg-surface/80 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{title}</h2>{action}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub, tone = "text-ink", testId }: { label: string; value: string; sub?: string; tone?: string; testId: string }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-line bg-surface/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-soft">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

const shareItems = (list: Share[], label: (k: string) => string) =>
  list.map((s) => ({ label: s.key === "others" ? "Others" : label(s.key), count: s.count, pct: s.pct, note: s.failed ? `${num(s.failed)} failed` : undefined }));

export default async function AdminAiUsage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const rangeRaw = sp(raw.range);
  const range: AiRange = isAiRange(rangeRaw) ? rangeRaw : "24h";
  const f = cleanAiFilters({ provider: sp(raw.provider), model: sp(raw.model), feature: sp(raw.feature), status: sp(raw.status), user: sp(raw.user) });
  const params: Record<string, string | undefined> = { range: range === "24h" ? undefined : range, ...f, page: sp(raw.page) };
  const [s, calls] = await Promise.all([loadAiStats(db, range), loadAiCalls(db, { ...f, page: pageFrom(params.page) })]);
  const filterQs = new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString();
  const filtered = Object.values(f).some(Boolean);
  const base = "/admin/ai-usage";

  return (
    <div data-testid="admin-ai-usage">
      <SectionHeading title="AI usage" description="Every model call TARGET makes (chat, scheduled, browser steps…). Counters only: prompts, replies and keys are never stored."
        actions={<a href={`/api/admin/ai-usage/export${filterQs ? `?${filterQs}` : ""}`} download className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3" data-testid="ai-export">Export CSV</a>} />

      <div role="group" aria-label="Range" className="mt-3 inline-flex rounded-full border border-line bg-bg/60 p-0.5">
        {AI_RANGES.map((r) => (
          <Link key={r} href={hrefWith(base, params, { range: r === "24h" ? undefined : r })} aria-current={range === r ? "true" : undefined} data-testid={`ai-range-${r}`}
            className={`inline-flex h-7 min-w-[44px] items-center justify-center rounded-full px-2.5 text-xs font-medium ${range === r ? "bg-accent-subtle text-accent-strong" : "text-muted hover:text-ink"}`}>{r}</Link>
        ))}
      </div>

      {s.error ? (
        <div className="mt-4"><LoadError retryHref={base}>Couldn&apos;t load AI usage. Run supabase/migrations/0020_ai_usage_feedback.sql if you haven&apos;t yet.</LoadError></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="ai-tiles">
            <Tile testId="ai-requests" label={`Requests · ${range}`} value={num(s.requests)} sub={`${num(s.attempts)} model attempts · ${num(s.racesWon)} races won`} />
            <Tile testId="ai-failure" label="Failure rate" value={pctText(s.failureRate)} sub={`${num(s.failedRequests)} requests got no answer · ${num(s.attemptErrors)} attempt errors`} tone={s.failureRate != null && s.failureRate >= 0.1 ? "text-danger" : "text-ink"} />
            <Tile testId="ai-latency" label="Latency avg / p95" value={`${ms(s.latency.avg)} / ${ms(s.latency.p95)}`} sub="Successful calls, start to last word" />
            <Tile testId="ai-ttft" label="First word avg / p95" value={`${ms(s.ttft.avg)} / ${ms(s.ttft.p95)}`} sub={s.tokens.withCounts ? `Tokens: ${num(s.tokens.input)} in · ${num(s.tokens.output)} out` : "Token counts appear when the API returns them"} />
          </div>

          <div className="mt-3">
            <Card title={<>Requests over {RANGE_LABEL[range]} <span className="font-normal text-muted">({num(s.requests)})</span></>} testId="ai-chart"
              action={<span className="flex gap-3 text-[11px] text-muted"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded bg-ok" />Requests</span><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded border-t border-dashed border-accent" />Failed</span></span>}>
              {s.requests === 0 ? <p className="py-12 text-center text-sm text-muted" data-testid="ai-chart-empty">No AI calls in this range yet. Rows appear as people chat (after migration 0020).</p>
                : <LineChart points={s.series.map((b) => ({ t: b.t, a: b.requests, b: b.failed }))} labelA="requests" labelB="failed" formatT={formatFor(range)} />}
              {s.capped && <p className="mt-2 text-xs text-warn">Only the newest 20,000 attempts in this range are counted.</p>}
            </Card>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="By provider" action={<span className="text-[11px] text-muted">who answered</span>} testId="ai-providers">
              {s.providers.length ? <ShareBars testId="ai-provider" items={shareItems(s.providers, (k) => AI_PROVIDER_LABEL[k] ?? k)} /> : <p className="py-6 text-center text-sm text-muted">No answers in this range.</p>}
            </Card>
            <Card title="By model" action={<span className="text-[11px] text-muted">who answered</span>} testId="ai-models">
              {s.models.length ? <ShareBars testId="ai-model" items={shareItems(s.models, (k) => k)} /> : <p className="py-6 text-center text-sm text-muted">No answers in this range.</p>}
            </Card>
            <Card title="By feature" action={<span className="text-[11px] text-muted">requests</span>} testId="ai-features">
              {s.features.length ? <ShareBars testId="ai-feature" items={shareItems(s.features, (k) => FEATURE_LABEL[k] ?? k)} barClass="bg-ok/70" /> : <p className="py-6 text-center text-sm text-muted">No requests in this range.</p>}
            </Card>
          </div>

          <div className="mt-3">
            <Card title="Top users by requests" action={<span className="text-[11px] text-muted">{RANGE_LABEL[range]}</span>} testId="ai-top-users">
              {s.topUsers.length === 0 ? <p className="py-6 text-center text-sm text-muted">No signed-in usage in this range.</p> : (
                <ol className="divide-y divide-line">
                  {s.topUsers.map((u, i) => (
                    <li key={u.user_id} className="flex items-center gap-3 py-2 text-sm" data-testid="ai-top-user">
                      <span className="w-5 text-right text-xs tabular-nums text-muted-soft">{i + 1}</span>
                      <Link href={`/admin/users/${u.user_id}`} className="min-w-0 flex-1 truncate text-accent hover:underline">{u.email || u.user_id.slice(0, 8)}</Link>
                      <Link href={hrefWith(base, params, { user: u.user_id })} className="hidden text-xs text-muted hover:text-ink sm:inline">calls →</Link>
                      <span className="w-24 shrink-0 text-right tabular-nums text-ink">{num(u.requests)} <span className="text-xs text-muted">· {u.pct.toFixed(1)}%</span></span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      )}

      <h3 className="mt-8 text-sm font-semibold text-ink">Recent calls</h3>
      <p className="text-xs text-muted">One row per model attempt. A raced call shows the winner and the models cancelled when it won.</p>
      <Chips base={base} params={params} name="status" label="Status" options={[{ value: "ok", label: "Answered" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled (lost race)" }]} />
      <Chips base={base} params={params} name="provider" label="Provider" options={Object.entries(AI_PROVIDER_LABEL).map(([value, label]) => ({ value, label }))} />
      <Chips base={base} params={params} name="feature" label="Feature" options={Object.entries(FEATURE_LABEL).map(([value, label]) => ({ value, label }))} />
      {(f.model || f.user) && (
        <p className="mt-3 flex flex-wrap gap-2 text-xs text-muted" data-testid="ai-extra-filters">
          {f.model && <Link href={hrefWith(base, params, { model: undefined })} className="rounded-full border border-accent/40 bg-accent-subtle px-3 py-1 text-accent-strong">Model: {truncate(f.model, 40)} ✕</Link>}
          {f.user && <Link href={hrefWith(base, params, { user: undefined })} className="rounded-full border border-accent/40 bg-accent-subtle px-3 py-1 text-accent-strong">User: {f.user.slice(0, 8)} ✕</Link>}
        </p>
      )}
      <div className="mt-4" data-testid="ai-calls">
        {calls.error && <LoadError retryHref={base}>Couldn&apos;t load AI calls. Check that migration 0020 has run.</LoadError>}
        {!calls.error && calls.rows.length === 0 && <Empty title={filtered ? "No calls match these filters" : "No AI calls recorded yet"}>{filtered ? <Link href={base} className="text-accent hover:underline">Clear filters</Link> : "Rows appear as people use TARGET after migration 0020 has run."}</Empty>}
        {calls.rows.length > 0 && (
          <>
            {/* Phones: cards */}
            <ul className="space-y-2 md:hidden">
              {calls.rows.map((c) => (
                <li key={c.id ?? `${c.request_id}-${c.attempt}`} className="rounded-2xl border border-line bg-surface/80 p-3" data-testid="ai-call-card">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <StatusBadge c={c} />
                    <span>{AI_PROVIDER_LABEL[c.provider] ?? c.provider}</span>
                    <span>·</span><span>{FEATURE_LABEL[c.feature] ?? c.feature}</span>
                    <span className="ml-auto">{fmt(c.created_at)}</span>
                  </div>
                  <Link href={hrefWith(base, params, { model: c.model })} className="mt-1 block truncate font-mono text-xs text-ink hover:text-accent">{c.model}</Link>
                  <p className="mt-1 text-xs text-muted">{ms(c.latency_ms)}{c.ttft_ms != null ? ` · first word ${ms(c.ttft_ms)}` : ""}{c.input_tokens != null || c.output_tokens != null ? ` · ${num(c.input_tokens)}/${num(c.output_tokens)} tok` : ""}</p>
                  {c.user_id && <Link href={`/admin/users/${c.user_id}`} className="mt-1 block truncate text-xs text-accent hover:underline">{c.email || c.user_id.slice(0, 8)}</Link>}
                </li>
              ))}
            </ul>
            {/* Wider screens: table */}
            <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface/80 md:block">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-soft">
                  <th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Provider · model</th>
                  <th className="px-3 py-2 font-medium">Feature</th><th className="px-3 py-2 text-right font-medium">Latency</th><th className="px-3 py-2 text-right font-medium">First word</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens in/out</th><th className="px-3 py-2 font-medium">User</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {calls.rows.map((c) => (
                    <tr key={c.id ?? `${c.request_id}-${c.attempt}`} data-testid="ai-call-row">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{fmt(c.created_at)}</td>
                      <td className="px-3 py-2"><StatusBadge c={c} /></td>
                      <td className="max-w-[280px] px-3 py-2"><span className="text-xs text-muted">{AI_PROVIDER_LABEL[c.provider] ?? c.provider} · </span><Link href={hrefWith(base, params, { model: c.model })} className="font-mono text-xs text-ink hover:text-accent" title={c.model}>{truncate(c.model, 42)}</Link></td>
                      <td className="px-3 py-2 text-xs text-ink-soft">{FEATURE_LABEL[c.feature] ?? c.feature}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">{ms(c.latency_ms)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">{ms(c.ttft_ms)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">{c.input_tokens == null && c.output_tokens == null ? "—" : `${num(c.input_tokens)} / ${num(c.output_tokens)}`}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-xs">{c.user_id ? <Link href={`/admin/users/${c.user_id}`} className="text-accent hover:underline">{c.email || c.user_id.slice(0, 8)}</Link> : <span className="text-muted-soft">system</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {!calls.error && <Pager base={base} params={params} page={calls.page} pages={calls.pages} total={calls.total} />}
      <p className="mt-6 text-[11px] text-muted-soft">Times in IST. Updated {fmt(new Date().toISOString())}.</p>
    </div>
  );
}

function StatusBadge({ c }: { c: { success: boolean; error_code: string | null; race_won: boolean | null } }) {
  if (c.success) return <Badge tone="ok">{c.race_won ? "Won race" : "Answered"}{c.error_code === "client_closed" ? " · stopped" : ""}</Badge>;
  if (c.error_code === "cancelled") return <Badge tone="neutral">Lost race</Badge>;
  return <Badge tone="danger">{c.error_code ? c.error_code.replace(/_/g, " ") : "Failed"}</Badge>;
}
