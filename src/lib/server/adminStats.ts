import type { Db } from "@/lib/server/auth";
import { allUsers, emailsFor, startOfTodayIST } from "@/lib/server/adminData";

/**
 * Dashboard numbers for /admin (service-role client from requireAdmin()). Bucketing is pure and exported for tests.
 * Large reads are capped and say so (capped: true) instead of silently undercounting.
 */

const HOUR = 3600000;
const DAY = 86400000;
const ROW_CAP = 20000;

export type Range = "3h" | "24h" | "7d" | "30d";
export const RANGES: Range[] = ["3h", "24h", "7d", "30d"];
export const RANGE_SPEC: Record<Range, { span: number; buckets: number }> = {
  "3h": { span: 3 * HOUR, buckets: 12 },   // 15 min
  "24h": { span: DAY, buckets: 24 },       // 1 h
  "7d": { span: 7 * DAY, buckets: 28 },    // 6 h
  "30d": { span: 30 * DAY, buckets: 30 },  // 1 day
};
export const isRange = (v: unknown): v is Range => typeof v === "string" && (RANGES as string[]).includes(v);

export type Bucket = { t: string; messages: number; users: number };

/** Split [now - span, now] into equal buckets and count messages + distinct users per bucket. */
export function bucketActivity(rows: { user_id: string; created_at: string }[], range: Range, now: number): Bucket[] {
  const { span, buckets } = RANGE_SPEC[range];
  const size = span / buckets;
  const start = now - span;
  const msgs = new Array<number>(buckets).fill(0);
  const users = Array.from({ length: buckets }, () => new Set<string>());
  for (const r of rows) {
    const at = Date.parse(r.created_at);
    if (!(at >= start && at <= now)) continue;
    const i = Math.min(buckets - 1, Math.floor((at - start) / size));
    msgs[i] += 1;
    users[i].add(r.user_id);
  }
  return msgs.map((m, i) => ({ t: new Date(start + (i + 1) * size).toISOString(), messages: m, users: users[i].size }));
}

/** Count timestamps into n equal buckets ending at `now` (for sparklines). */
export function spark(times: string[], n: number, span: number, now: number): number[] {
  const out = new Array<number>(n).fill(0);
  const start = now - span;
  const size = span / n;
  for (const iso of times) {
    const at = Date.parse(iso);
    if (at >= start && at <= now) out[Math.min(n - 1, Math.floor((at - start) / size))] += 1;
  }
  return out;
}

/** Distinct users per bucket (for the active-users sparkline). */
export function sparkDistinct(rows: { user_id: string; created_at: string }[], n: number, span: number, now: number): number[] {
  const sets = Array.from({ length: n }, () => new Set<string>());
  const start = now - span;
  const size = span / n;
  for (const r of rows) {
    const at = Date.parse(r.created_at);
    if (at >= start && at <= now) sets[Math.min(n - 1, Math.floor((at - start) / size))].add(r.user_id);
  }
  return sets.map((s) => s.size);
}

async function rowsSince<T>(db: Db, table: string, cols: string, since: string, extra?: (q: { eq(k: string, v: unknown): unknown }) => unknown): Promise<{ rows: T[]; capped: boolean; error: boolean }> {
  try {
    let q = db.from(table).select(cols).gte("created_at", since);
    if (extra) q = extra(q as unknown as { eq(k: string, v: unknown): unknown }) as typeof q;
    const { data, error } = await q.order("created_at", { ascending: false }).limit(ROW_CAP);
    if (error) return { rows: [], capped: false, error: true };
    const rows = (data ?? []) as T[];
    return { rows, capped: rows.length >= ROW_CAP, error: false };
  } catch { return { rows: [], capped: false, error: true }; }
}

export async function loadActivitySeries(db: Db, range: Range, now = Date.now()): Promise<{ range: Range; buckets: Bucket[]; capped: boolean; error: boolean }> {
  const since = new Date(now - RANGE_SPEC[range].span).toISOString();
  const r = await rowsSince<{ user_id: string; created_at: string }>(db, "messages", "user_id, created_at", since, (q) => q.eq("role", "user"));
  return { range, buckets: bucketActivity(r.rows, range, now), capped: r.capped, error: r.error };
}

export type Presence = { user_id: string; country: string | null; device: string | null; last_seen_at: string };

export type Dashboard = {
  users: { total: number | null; newWeek: number | null; spark: number[] };
  active: { today: number | null; now15: number | null; yesterday: number | null; spark: number[] };
  messages: { today: number | null; chatsToday: number | null; spark: number[] };
  errors: { last24h: number | null; today: number | null; spark: number[] };
  jobs: { done: number; failed: number; running: number; waiting: number; cancelled: number; total: number; error: boolean };
  countries: { code: string | null; users: number; pct: number }[];
  devices: { label: string; users: number; pct: number }[];
  presenceUsers: number;
  presenceReady: boolean;
  activity: { id: string; user_id: string; email: string; category: string; title: string; status: string | null; created_at: string }[];
  recentErrors: { id: string; source: string; message: string; url: string | null; created_at: string }[];
  capped: boolean;
};

/** Top n plus an "Others" row, with percentages of the whole. */
export function shareTable<K>(counts: Map<K, number>, n: number): { key: K | "others"; count: number; pct: number }[] {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n).map(([key, count]) => ({ key: key as K | "others", count, pct: (count / total) * 100 }));
  const rest = sorted.slice(n).reduce((a, [, c]) => a + c, 0);
  if (rest) top.push({ key: "others", count: rest, pct: (rest / total) * 100 });
  return top;
}

export async function loadDashboard(db: Db, now = Date.now()): Promise<Dashboard> {
  const today = startOfTodayIST(new Date(now));
  const yesterday = new Date(Date.parse(today) - DAY).toISOString();
  const d14 = new Date(now - 14 * DAY).toISOString();
  const d7 = new Date(now - 7 * DAY).toISOString();
  const d1 = new Date(now - DAY).toISOString();
  const safe = async <T,>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> => { try { const r = await p; return r.error ? null : ((r.data ?? []) as T[]); } catch { return null; } };
  const countSince = async (table: string, since: string) => {
    try { const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).gte("created_at", since); return error ? null : count ?? 0; } catch { return null; }
  };

  const [usersRes, msgs, errs, jobs, presence, chatsToday, activity, recentErrors] = await Promise.all([
    allUsers(db).catch(() => null),
    rowsSince<{ user_id: string; created_at: string }>(db, "messages", "user_id, created_at", d14, (q) => q.eq("role", "user")),
    rowsSince<{ created_at: string }>(db, "error_events", "created_at", d1),
    rowsSince<{ status: string }>(db, "browser_jobs", "status", d7),
    safe<Presence>(db.from("user_presence").select("user_id, country, device, last_seen_at").limit(ROW_CAP)),
    countSince("conversations", today),
    safe<{ id: string; user_id: string; category: string; title: string; status: string | null; created_at: string }>(db.from("activity_events").select("id, user_id, category, title, status, created_at").order("created_at", { ascending: false }).limit(8)),
    safe<{ id: string; source: string; message: string; url: string | null; created_at: string }>(db.from("error_events").select("id, source, message, url, created_at").order("created_at", { ascending: false }).limit(8)),
  ]);

  const users = usersRes?.users ?? null;
  const pres = presence ?? [];
  const activeToday = new Set<string>();
  const activeYesterday = new Set<string>();
  for (const m of msgs.rows) {
    if (m.created_at >= today) activeToday.add(m.user_id);
    else if (m.created_at >= yesterday) activeYesterday.add(m.user_id);
  }
  for (const p of pres) if (p.last_seen_at >= today) activeToday.add(p.user_id);
  for (const u of users ?? []) if (u.last_sign_in_at && u.last_sign_in_at >= today) activeToday.add(u.id);
  const now15 = presence ? pres.filter((p) => now - Date.parse(p.last_seen_at) <= 15 * 60000).length : null;

  const countryCounts = new Map<string | null, number>();
  const deviceCounts = new Map<string, number>();
  for (const p of pres) {
    countryCounts.set(p.country, (countryCounts.get(p.country) ?? 0) + 1);
    if (p.device) deviceCounts.set(p.device, (deviceCounts.get(p.device) ?? 0) + 1);
  }

  const j = { done: 0, failed: 0, running: 0, waiting: 0, cancelled: 0, total: jobs.rows.length, error: jobs.error };
  for (const r of jobs.rows) {
    if (r.status === "done") j.done++;
    else if (r.status === "failed") j.failed++;
    else if (r.status === "running") j.running++;
    else if (r.status === "cancelled") j.cancelled++;
    else j.waiting++;
  }

  const emails = await emailsFor(db, (activity ?? []).map((a) => a.user_id));
  return {
    users: {
      total: users ? users.length : null,
      newWeek: users ? users.filter((u) => u.created_at >= d7).length : null,
      spark: users ? spark(users.map((u) => u.created_at), 14, 14 * DAY, now) : [],
    },
    active: { today: msgs.error && !users ? null : activeToday.size, now15, yesterday: msgs.error ? null : activeYesterday.size, spark: sparkDistinct(msgs.rows, 14, 14 * DAY, now) },
    messages: { today: msgs.error ? null : msgs.rows.filter((m) => m.created_at >= today).length, chatsToday, spark: spark(msgs.rows.map((m) => m.created_at), 14, 14 * DAY, now) },
    errors: { last24h: errs.error ? null : errs.rows.length, today: errs.error ? null : errs.rows.filter((e) => e.created_at >= today).length, spark: spark(errs.rows.map((e) => e.created_at), 12, DAY, now) },
    jobs: j,
    countries: shareTable(countryCounts, 8).map((r) => ({ code: r.key === "others" ? "others" : (r.key as string | null), users: r.count, pct: r.pct })),
    devices: shareTable(deviceCounts, 6).map((r) => ({ label: r.key === "others" ? "Others" : String(r.key), users: r.count, pct: r.pct })),
    presenceUsers: pres.length,
    presenceReady: presence !== null,
    activity: (activity ?? []).map((a) => ({ ...a, email: emails.get(a.user_id) ?? "" })),
    recentErrors: recentErrors ?? [],
    capped: msgs.capped || errs.capped || jobs.capped,
  };
}

/** Badge counts for the admin sidebar, cached 30 s per server instance. */
export type NavCounts = { users: number | null; errors24h: number | null; jobsActive: number | null; scheduledActive: number | null; sharesActive: number | null; feedbackNew: number | null; switchesOff: number };
let navCache: { at: number; value: NavCounts } | null = null;
export function clearNavCache() { navCache = null; }

export async function loadNavCounts(db: Db, switchesOff: number, now = Date.now()): Promise<NavCounts> {
  if (navCache && now - navCache.at < 30000) return { ...navCache.value, switchesOff };
  const c = async (table: string, f: (q: ReturnType<ReturnType<Db["from"]>["select"]>) => unknown) => {
    try { const { count, error } = await (f(db.from(table).select("id", { count: "exact", head: true })) as PromiseLike<{ count: number | null; error: unknown }>); return error ? null : count ?? 0; } catch { return null; }
  };
  const [u, errors24h, jobsActive, scheduledActive, sharesActive, feedbackNew] = await Promise.all([
    allUsers(db).then((r) => r.users.length, () => null),
    c("error_events", (q) => q.gte("created_at", new Date(now - DAY).toISOString())),
    c("browser_jobs", (q) => q.in("status", ["queued", "running"])),
    c("scheduled_jobs", (q) => q.eq("status", "active")),
    c("conversation_shares", (q) => q.is("revoked_at", null)),
    c("feedback", (q) => q.eq("status", "new")),
  ]);
  const value = { users: u, errors24h, jobsActive, scheduledActive, sharesActive, feedbackNew, switchesOff };
  navCache = { at: now, value };
  return value;
}

/** Global admin search: users by email/id, browser jobs by id or goal text, errors by message text. */
export async function adminSearch(db: Db, raw: string): Promise<{ users: { id: string; email: string; created_at: string }[]; jobs: { id: string; goal: string; status: string; created_at: string }[]; errors: { id: string; source: string; message: string; created_at: string }[]; error: boolean }> {
  const q = raw.trim().slice(0, 100);
  if (!q) return { users: [], jobs: [], errors: [], error: false };
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  let error = false;
  const [usersRes, jobs, errors] = await Promise.all([
    allUsers(db).catch(() => { error = true; return null; }),
    (async () => {
      try {
        const { data, error: e } = uuid
          ? await db.from("browser_jobs").select("id, goal, status, created_at").eq("id", q).limit(1)
          : await db.from("browser_jobs").select("id, goal, status, created_at").ilike("goal", like).order("created_at", { ascending: false }).limit(10);
        if (e) error = true;
        return (data ?? []) as { id: string; goal: string; status: string; created_at: string }[];
      } catch { error = true; return []; }
    })(),
    (async () => {
      try {
        const { data, error: e } = await db.from("error_events").select("id, source, message, created_at").ilike("message", like).order("created_at", { ascending: false }).limit(10);
        if (e) error = true;
        return (data ?? []) as { id: string; source: string; message: string; created_at: string }[];
      } catch { error = true; return []; }
    })(),
  ]);
  const lower = q.toLowerCase();
  const users = (usersRes?.users ?? []).filter((u) => u.email.toLowerCase().includes(lower) || u.id === lower).slice(0, 10).map((u) => ({ id: u.id, email: u.email, created_at: u.created_at }));
  return { users, jobs, errors, error };
}
