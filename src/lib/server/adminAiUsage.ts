import type { Db } from "@/lib/server/auth";
import { emailsFor } from "@/lib/server/adminData";
import { PAGE_SIZE } from "@/lib/adminConfig";

/**
 * /admin → AI usage (table ai_usage, migration 0020). Service-role client from requireAdmin() only.
 * The table holds counters and labels per model attempt; there is no prompt or reply text to select.
 */

const DAY = 86400000;
export const AI_ROW_CAP = 20000;

export type AiRange = "24h" | "7d" | "30d";
export const AI_RANGES: AiRange[] = ["24h", "7d", "30d"];
export const AI_RANGE_SPEC: Record<AiRange, { span: number; buckets: number }> = {
  "24h": { span: DAY, buckets: 24 },     // 1 h
  "7d": { span: 7 * DAY, buckets: 28 },  // 6 h
  "30d": { span: 30 * DAY, buckets: 30 }, // 1 day
};
export const isAiRange = (v: unknown): v is AiRange => typeof v === "string" && (AI_RANGES as string[]).includes(v);

export const AI_PROVIDER_LABEL: Record<string, string> = { nim: "NVIDIA NIM", openrouter: "OpenRouter", custom: "Custom" };
export const AI_STATUSES = ["ok", "failed", "cancelled"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export type AiRow = {
  id?: number; created_at: string; user_id: string | null; request_id: string | null; provider: string; model: string; feature: string;
  attempt?: number | null; streamed?: boolean; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; ttft_ms: number | null;
  success: boolean; error_code: string | null; race_won: boolean | null;
};

export type Share = { key: string; count: number; pct: number; failed?: number };

export type AiStats = {
  range: AiRange;
  requests: number; attempts: number; failedRequests: number; failureRate: number | null;
  attemptErrors: number; cancelled: number; racesWon: number;
  latency: { avg: number | null; p95: number | null };
  ttft: { avg: number | null; p95: number | null };
  tokens: { input: number; output: number; withCounts: number };
  series: { t: string; requests: number; failed: number }[];
  providers: Share[]; models: Share[]; features: Share[];
  topUsers: { user_id: string; email: string; requests: number; pct: number }[];
  capped: boolean; error: boolean;
};

/** Nearest-rank percentile (p in 0..100) of a list of numbers; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))];
}

const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);

function shares(counts: Map<string, { n: number; failed: number }>, top: number): Share[] {
  const total = [...counts.values()].reduce((a, b) => a + b.n, 0);
  if (!total) return [];
  const sorted = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const out: Share[] = sorted.slice(0, top).map(([key, v]) => ({ key, count: v.n, pct: (v.n / total) * 100, failed: v.failed }));
  const rest = sorted.slice(top);
  if (rest.length) {
    const n = rest.reduce((a, [, v]) => a + v.n, 0);
    out.push({ key: "others", count: n, pct: (n / total) * 100, failed: rest.reduce((a, [, v]) => a + v.failed, 0) });
  }
  return out;
}

const bump = (m: Map<string, { n: number; failed: number }>, k: string, failed: boolean) => {
  const v = m.get(k) ?? { n: 0, failed: 0 };
  v.n += 1; if (failed) v.failed += 1;
  m.set(k, v);
};

/**
 * Pure aggregation (exported for tests). A "request" is one llm() call: rows sharing request_id (a row without one
 * counts on its own). A request failed when none of its attempts succeeded. Provider/model splits count the model
 * that ANSWERED each request; their `failed` counts failed attempts on that model (cancelled race losers excluded).
 * Latency and time-to-first-token use successful attempts only.
 */
export function aggregateAiUsage(rows: AiRow[], range: AiRange, now: number): Omit<AiStats, "topUsers" | "capped" | "error"> & { userCounts: Map<string, number> } {
  const { span, buckets } = AI_RANGE_SPEC[range];
  const start = now - span;
  const size = span / buckets;
  const inRange = rows.filter((r) => { const t = Date.parse(r.created_at); return t >= start && t <= now; });

  type Req = { at: number; ok: boolean; user: string | null; winner: AiRow | null; feature: string };
  const reqs = new Map<string, Req>();
  inRange.forEach((r, i) => {
    const key = r.request_id ?? `row:${r.id ?? i}`;
    const at = Date.parse(r.created_at);
    const q = reqs.get(key) ?? { at, ok: false, user: r.user_id, winner: null, feature: r.feature };
    q.at = Math.min(q.at, at);
    if (r.success) { q.ok = true; if (!q.winner || r.race_won) q.winner = r; }
    if (!q.user && r.user_id) q.user = r.user_id;
    reqs.set(key, q);
  });

  const series = Array.from({ length: buckets }, (_, i) => ({ t: new Date(start + (i + 1) * size).toISOString(), requests: 0, failed: 0 }));
  const providers = new Map<string, { n: number; failed: number }>();
  const models = new Map<string, { n: number; failed: number }>();
  const features = new Map<string, { n: number; failed: number }>();
  const userCounts = new Map<string, number>();
  let failedRequests = 0;
  for (const q of reqs.values()) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor((q.at - start) / size)));
    series[b].requests += 1;
    if (!q.ok) { series[b].failed += 1; failedRequests += 1; }
    if (q.winner) { bump(providers, q.winner.provider, false); bump(models, q.winner.model, false); }
    bump(features, q.feature || "other", !q.ok);
    if (q.user) userCounts.set(q.user, (userCounts.get(q.user) ?? 0) + 1);
  }
  // Failed attempts per provider/model (not cancelled race losers): shown next to each bar.
  let attemptErrors = 0, cancelled = 0, racesWon = 0;
  for (const r of inRange) {
    if (r.race_won === true) racesWon += 1;
    if (r.success) continue;
    if (r.error_code === "cancelled") { cancelled += 1; continue; }
    attemptErrors += 1;
    const p = providers.get(r.provider) ?? { n: 0, failed: 0 }; p.failed += 1; providers.set(r.provider, p);
    const m = models.get(r.model) ?? { n: 0, failed: 0 }; m.failed += 1; models.set(r.model, m);
  }
  const ok = inRange.filter((r) => r.success);
  const lat = ok.map((r) => r.latency_ms).filter((v): v is number => typeof v === "number");
  const ttft = ok.map((r) => r.ttft_ms).filter((v): v is number => typeof v === "number");
  const withTokens = inRange.filter((r) => r.input_tokens != null || r.output_tokens != null);
  const requests = reqs.size;
  return {
    range, requests, attempts: inRange.length, failedRequests, failureRate: requests ? failedRequests / requests : null,
    attemptErrors, cancelled, racesWon,
    latency: { avg: avg(lat), p95: percentile(lat, 95) },
    ttft: { avg: avg(ttft), p95: percentile(ttft, 95) },
    tokens: { input: withTokens.reduce((a, r) => a + (r.input_tokens ?? 0), 0), output: withTokens.reduce((a, r) => a + (r.output_tokens ?? 0), 0), withCounts: withTokens.length },
    series,
    // Bars: share of answered requests; a provider/model with only failed attempts still shows (0 answered).
    providers: shares(providers, 6),
    models: shares(models, 8),
    features: shares(features, 10),
    userCounts,
  };
}

const COLS = "id, created_at, user_id, request_id, provider, model, feature, attempt, streamed, input_tokens, output_tokens, latency_ms, ttft_ms, success, error_code, race_won";

export async function loadAiStats(db: Db, range: AiRange, now = Date.now()): Promise<AiStats> {
  const since = new Date(now - AI_RANGE_SPEC[range].span).toISOString();
  const empty = aggregateAiUsage([], range, now);
  try {
    const { data, error } = await db.from("ai_usage").select(COLS).gte("created_at", since).order("created_at", { ascending: false }).limit(AI_ROW_CAP);
    if (error) return { ...empty, topUsers: [], capped: false, error: true };
    const rows = (data ?? []) as AiRow[];
    const a = aggregateAiUsage(rows, range, now);
    const top = [...a.userCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
    const emails = await emailsFor(db, top.map(([id]) => id));
    const { userCounts: _u, ...rest } = a; void _u;
    return { ...rest, topUsers: top.map(([user_id, n]) => ({ user_id, email: emails.get(user_id) ?? "", requests: n, pct: a.requests ? (n / a.requests) * 100 : 0 })), capped: rows.length >= AI_ROW_CAP, error: false };
  } catch {
    return { ...empty, topUsers: [], capped: false, error: true };
  }
}

/** Dashboard card: which models answered in the last 7 days (top 6 + others). null = table not readable. */
export async function loadModelShare(db: Db, now = Date.now()): Promise<{ models: Share[]; total: number; capped: boolean } | null> {
  try {
    const { data, error } = await db.from("ai_usage").select("model, provider").eq("success", true).gte("created_at", new Date(now - 7 * DAY).toISOString()).order("created_at", { ascending: false }).limit(AI_ROW_CAP);
    if (error) return null;
    const rows = (data ?? []) as { model: string; provider: string }[];
    const m = new Map<string, { n: number; failed: number }>();
    for (const r of rows) bump(m, r.model, false);
    return { models: shares(m, 6), total: rows.length, capped: rows.length >= AI_ROW_CAP };
  } catch { return null; }
}

export type AiCallFilters = { provider?: string; model?: string; feature?: string; status?: string; user?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the filter values we know how to apply (anything else is ignored rather than passed to the query). */
export function cleanAiFilters(raw: Record<string, string | undefined>): AiCallFilters {
  const slug = (v?: string) => (v && /^[a-z0-9_]{1,32}$/.test(v) ? v : undefined);
  return {
    provider: raw.provider && raw.provider in AI_PROVIDER_LABEL ? raw.provider : undefined,
    model: raw.model && raw.model.length <= 160 && !/[\u0000-\u001f]/.test(raw.model) ? raw.model : undefined,
    feature: slug(raw.feature),
    status: raw.status && (AI_STATUSES as readonly string[]).includes(raw.status) ? raw.status : undefined,
    user: raw.user && UUID.test(raw.user) ? raw.user.toLowerCase() : undefined,
  };
}

type Q = { eq(k: string, v: unknown): Q; neq(k: string, v: unknown): Q };
function applyFilters<T>(q: T, f: AiCallFilters): T {
  let x = q as unknown as Q;
  if (f.provider) x = x.eq("provider", f.provider);
  if (f.model) x = x.eq("model", f.model);
  if (f.feature) x = x.eq("feature", f.feature);
  if (f.user) x = x.eq("user_id", f.user);
  if (f.status === "ok") x = x.eq("success", true);
  // Every failed attempt carries an error_code, so "not cancelled" is a plain inequality.
  if (f.status === "failed") x = x.eq("success", false).neq("error_code", "cancelled");
  if (f.status === "cancelled") x = x.eq("error_code", "cancelled");
  return x as unknown as T;
}

export type AiCall = AiRow & { email: string };

/** Recent calls table: newest first, PAGE_SIZE per page (or `limit` rows for CSV), filters above. */
export async function loadAiCalls(db: Db, opts: AiCallFilters & { page: number; limit?: number }): Promise<{ rows: AiCall[]; total: number; page: number; pages: number; error: boolean }> {
  const per = opts.limit ?? PAGE_SIZE;
  try {
    const head = applyFilters(db.from("ai_usage").select("id", { count: "exact", head: true }), opts);
    const { count, error: cErr } = await (head as unknown as PromiseLike<{ count: number | null; error: unknown }>);
    if (cErr) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const total = count ?? 0;
    const pages = Math.max(1, Math.ceil(total / per));
    const page = Math.min(Math.max(1, opts.page), pages);
    const q = applyFilters(db.from("ai_usage").select(COLS), opts).order("created_at", { ascending: false }).range((page - 1) * per, page * per - 1);
    const { data, error } = await q;
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as AiRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id ?? "").filter(Boolean));
    return { rows: rows.map((r) => ({ ...r, email: r.user_id ? emails.get(r.user_id) ?? "" : "" })), total, page, pages, error: false };
  } catch {
    return { rows: [], total: 0, page: 1, pages: 1, error: true };
  }
}

/** Health page: calls and failure rate in the last 24 h, and the newest row's time. */
export async function aiUsagePulse(db: Db, now = Date.now()): Promise<{ ready: boolean; requests: number; failed: number; lastAt: string | null; capped: boolean }> {
  try {
    const { data, error } = await db.from("ai_usage").select("request_id, success, created_at").gte("created_at", new Date(now - DAY).toISOString()).order("created_at", { ascending: false }).limit(AI_ROW_CAP);
    if (error) return { ready: false, requests: 0, failed: 0, lastAt: null, capped: false };
    const rows = (data ?? []) as { request_id: string | null; success: boolean; created_at: string }[];
    const reqs = new Map<string, boolean>();
    rows.forEach((r, i) => { const k = r.request_id ?? `row:${i}`; reqs.set(k, (reqs.get(k) ?? false) || r.success); });
    let lastAt = rows[0]?.created_at ?? null;
    if (!lastAt) {
      const { data: last } = await db.from("ai_usage").select("created_at").order("created_at", { ascending: false }).limit(1);
      lastAt = ((last ?? []) as { created_at: string }[])[0]?.created_at ?? null;
    }
    return { ready: true, requests: reqs.size, failed: [...reqs.values()].filter((v) => !v).length, lastAt, capped: rows.length >= AI_ROW_CAP };
  } catch { return { ready: false, requests: 0, failed: 0, lastAt: null, capped: false }; }
}
