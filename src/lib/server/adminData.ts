import type { User } from "@supabase/supabase-js";
import type { Db } from "@/lib/server/auth";
import { PAGE_SIZE } from "@/lib/adminConfig";

/**
 * Read models for /admin. Every function takes the service-role client handed out by requireAdmin(), so callers
 * have already passed the ADMIN_EMAILS check. Secret columns are never selected: vault_secrets and custom_providers are
 * only counted, connections show connector name + status only (no previews, no sealed keys or tokens, no job inputs/code).
 */

export type Paged<T> = { rows: T[]; total: number; page: number; pages: number; error: boolean };
const pages = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));
const range = (page: number) => [(page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1] as const;

export type AdminUser = { id: string; email: string; created_at: string; last_sign_in_at: string | null; banned_until: string | null; provider: string };
export function toAdminUser(u: User): AdminUser {
  return {
    id: u.id, email: u.email ?? "", created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null,
    banned_until: (u as { banned_until?: string | null }).banned_until ?? null, provider: String(u.app_metadata?.provider ?? "email"),
  };
}
export const isBanned = (u: Pick<AdminUser, "banned_until">, now = Date.now()) => !!u.banned_until && Date.parse(u.banned_until) > now;

/** Every auth user (1000 per call, capped at maxPages pages). */
export async function allUsers(db: Db, maxPages = 20): Promise<{ users: AdminUser[]; capped: boolean }> {
  const out: AdminUser[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Could not list users");
    const batch = (data?.users ?? []) as User[];
    out.push(...batch.map(toAdminUser));
    if (batch.length < 1000) return { users: out, capped: false };
  }
  return { users: out, capped: true };
}

export async function emailsFor(db: Db, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const pairs = await Promise.all(uniq.map(async (id) => {
    try { const { data } = await db.auth.admin.getUserById(id); return [id, data?.user?.email ?? ""] as const; } catch { return [id, ""] as const; }
  }));
  return new Map(pairs);
}

/** The few filters the counters use (kept loose: Supabase's builder types get too deep for TypeScript here). */
type CountQuery = PromiseLike<{ count: number | null; error: unknown }> & { eq(k: string, v: unknown): CountQuery; gte(k: string, v: string): CountQuery };

async function count(db: Db, table: string, f?: (q: CountQuery) => CountQuery): Promise<number | null> {
  try {
    let q = db.from(table).select("id", { count: "exact", head: true }) as unknown as CountQuery;
    if (f) q = f(q);
    const { count: n, error } = await q;
    return error ? null : n ?? 0;
  } catch { return null; }
}

/** Midnight today in India (the app's home timezone), as an ISO instant. */
export function startOfTodayIST(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60000);
  const mid = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60000;
  return new Date(mid).toISOString();
}

export type Overview = {
  users: number | null; new7: number | null; new30: number | null; active7: number | null; activeCapped: boolean;
  chats: number | null; messages: number | null; jobsToday: number | null; errors24h: number | null; usersCapped: boolean;
};

export async function loadOverview(db: Db, now = Date.now()): Promise<Overview> {
  const d7 = new Date(now - 7 * 86400000).toISOString();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const d1 = new Date(now - 86400000).toISOString();
  const [usersRes, chats, messages, jobsToday, errors24h, recentMsgs] = await Promise.all([
    allUsers(db).catch(() => null),
    count(db, "conversations"),
    count(db, "messages"),
    count(db, "browser_jobs", (q) => q.gte("created_at", startOfTodayIST(new Date(now)))),
    count(db, "error_events", (q) => q.gte("created_at", d1)),
    (async () => {
      try {
        const { data, error } = await db.from("messages").select("user_id").eq("role", "user").gte("created_at", d7).limit(10000);
        return error ? null : ((data ?? []) as { user_id: string }[]);
      } catch { return null; }
    })(),
  ]);
  const users = usersRes?.users ?? null;
  let active7: number | null = null;
  if (users) {
    const ids = new Set(users.filter((u) => u.last_sign_in_at && u.last_sign_in_at >= d7).map((u) => u.id));
    for (const m of recentMsgs ?? []) ids.add(m.user_id);
    active7 = ids.size;
  }
  return {
    users: users ? users.length : null,
    new7: users ? users.filter((u) => u.created_at >= d7).length : null,
    new30: users ? users.filter((u) => u.created_at >= d30).length : null,
    active7, activeCapped: (recentMsgs?.length ?? 0) >= 10000,
    chats, messages, jobsToday, errors24h, usersCapped: !!usersRes?.capped,
  };
}

export type UserRow = AdminUser & { messages: number | null };

/** Users list: newest first, optional email search, PAGE_SIZE per page, with each row's message count. */
export async function loadUsers(db: Db, opts: { q?: string; page: number }): Promise<Paged<UserRow>> {
  try {
    const q = (opts.q ?? "").trim().toLowerCase();
    const { users } = await allUsers(db);
    const filtered = (q ? users.filter((u) => u.email.toLowerCase().includes(q) || u.id === q) : users)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const total = filtered.length;
    const page = Math.min(opts.page, pages(total));
    const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const rows = await Promise.all(slice.map(async (u) => ({ ...u, messages: await count(db, "messages", (x) => x.eq("user_id", u.id)) })));
    return { rows, total, page, pages: pages(total), error: false };
  } catch {
    return { rows: [], total: 0, page: 1, pages: 1, error: true };
  }
}

export type UserDetail = {
  user: AdminUser; counts: Record<"conversations" | "messages" | "browser_jobs" | "scheduled_jobs" | "vault_items" | "custom_providers" | "share_links", number | null>;
  connections: { connector_id: string; status: string; connected_at: string | null }[];
  activity: { id: string; category: string; title: string; status: string | null; created_at: string }[];
  jobs: { id: string; goal: string; mode: string; status: string; error: string | null; created_at: string }[];
  errors: { id: string; source: string; message: string; created_at: string }[];
  presence: { country: string | null; device: string | null; last_seen_at: string } | null;
};

export async function loadUserDetail(db: Db, id: string): Promise<UserDetail | null | "error"> {
  let user: AdminUser;
  try {
    const { data, error } = await db.auth.admin.getUserById(id);
    if (error || !data?.user) return error && !/not.?found/i.test(error.message ?? "") ? "error" : null;
    user = toAdminUser(data.user as User);
  } catch { return "error"; }
  const own = (q: CountQuery) => q.eq("user_id", id);
  const safe = async <T,>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => { try { const r = await p; return r.error ? [] : ((r.data ?? []) as T[]); } catch { return []; } };
  const [conversations, messages, browser_jobs, scheduled_jobs, vault_items, custom_providers, share_links, connections, activity, jobs, errors, presence] = await Promise.all([
    count(db, "conversations", own), count(db, "messages", own), count(db, "browser_jobs", own), count(db, "scheduled_jobs", own),
    count(db, "vault_secrets", own), count(db, "custom_providers", own), count(db, "conversation_shares", own),
    safe<UserDetail["connections"][number]>(db.from("connections").select("connector_id, status, connected_at").eq("user_id", id).limit(50)),
    safe<UserDetail["activity"][number]>(db.from("activity_events").select("id, category, title, status, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20)),
    safe<UserDetail["jobs"][number]>(db.from("browser_jobs").select("id, goal, mode, status, error, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10)),
    safe<UserDetail["errors"][number]>(db.from("error_events").select("id, source, message, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10)),
    safe<NonNullable<UserDetail["presence"]>>(db.from("user_presence").select("country, device, last_seen_at").eq("user_id", id).limit(1)),
  ]);
  return { user, counts: { conversations, messages, browser_jobs, scheduled_jobs, vault_items, custom_providers, share_links }, connections, activity, jobs, errors, presence: presence[0] ?? null };
}

export type ErrorRow = { id: string; source: string; message: string; stack: string | null; url: string | null; fingerprint: string; user_id: string | null; created_at: string };
export const ERROR_SOURCES = ["client", "server", "cron"] as const;

/** Escape % and _ so a search box can't turn into a wildcard pattern. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function loadErrors(db: Db, opts: { page: number; source?: string; q?: string; limit?: number }): Promise<Paged<ErrorRow>> {
  try {
    let qb = db.from("error_events").select("id, source, message, stack, url, fingerprint, user_id, created_at", { count: "exact" });
    if (opts.source && (ERROR_SOURCES as readonly string[]).includes(opts.source)) qb = qb.eq("source", opts.source);
    if (opts.q?.trim()) qb = qb.ilike("message", likeTerm(opts.q.trim().slice(0, 100)));
    qb = qb.order("created_at", { ascending: false });
    const [a, b] = opts.limit ? [0, opts.limit - 1] : range(opts.page);
    const { data, count: total, error } = await qb.range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const t = total ?? 0;
    return { rows: (data ?? []) as ErrorRow[], total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}

export type JobRow = { id: string; user_id: string; goal: string; mode: string; status: string; error: string | null; created_at: string; claimed_at: string | null; finished_at: string | null; email?: string };
export const JOB_STATUSES = ["needs_approval", "queued", "running", "done", "failed", "cancelled"] as const;

export function jobDurationMs(j: Pick<JobRow, "claimed_at" | "finished_at" | "status">, now = Date.now()): number | null {
  if (!j.claimed_at) return null;
  const end = j.finished_at ? Date.parse(j.finished_at) : j.status === "running" ? now : NaN;
  const ms = end - Date.parse(j.claimed_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export async function loadJobs(db: Db, opts: { page: number; status?: string }): Promise<Paged<JobRow>> {
  try {
    let qb = db.from("browser_jobs").select("id, user_id, goal, mode, status, error, created_at, claimed_at, finished_at", { count: "exact" });
    if (opts.status && (JOB_STATUSES as readonly string[]).includes(opts.status)) qb = qb.eq("status", opts.status);
    const [a, b] = range(opts.page);
    const { data, count: total, error } = await qb.order("created_at", { ascending: false }).range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as JobRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id));
    const t = total ?? 0;
    return { rows: rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? "" })), total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}

export type ScheduledRow = {
  id: string; user_id: string; title: string; cadence: string; status: string; time_of_day: string; timezone: string; next_run_at: string | null;
  last_run_at: string | null; last_status: string | null; last_error: string | null; run_count: number; allow_browser?: boolean; email?: string;
};
export const SCHEDULE_STATUSES = ["active", "paused", "done"] as const;

export async function loadScheduled(db: Db, opts: { page: number; status?: string }): Promise<Paged<ScheduledRow>> {
  try {
    let qb = db.from("scheduled_jobs").select("id, user_id, title, cadence, status, time_of_day, timezone, next_run_at, last_run_at, last_status, last_error, run_count", { count: "exact" });
    if (opts.status && (SCHEDULE_STATUSES as readonly string[]).includes(opts.status)) qb = qb.eq("status", opts.status);
    const [a, b] = range(opts.page);
    const { data, count: total, error } = await qb.order("next_run_at", { ascending: true, nullsFirst: false }).range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as ScheduledRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id));
    const t = total ?? 0;
    return { rows: rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? "" })), total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}

export type CronBeat = { at: string; by?: string; ran?: number; scanned?: number; disabled?: boolean } | null;

export async function loadCronStatus(db: Db): Promise<{ scheduled: CronBeat; proactive: CronBeat; lastJobRun: string | null; error: boolean }> {
  try {
    const [beats, last] = await Promise.all([
      db.from("admin_settings").select("key, value").in("key", ["cron:scheduled", "cron:proactive"]),
      db.from("scheduled_jobs").select("last_run_at").not("last_run_at", "is", null).order("last_run_at", { ascending: false }).limit(1),
    ]);
    const by = new Map((((beats.data ?? []) as { key: string; value: CronBeat }[])).map((r) => [r.key, r.value]));
    const lastJobRun = ((last.data ?? []) as { last_run_at: string }[])[0]?.last_run_at ?? null;
    return { scheduled: by.get("cron:scheduled") ?? null, proactive: by.get("cron:proactive") ?? null, lastJobRun, error: !!beats.error };
  } catch { return { scheduled: null, proactive: null, lastJobRun: null, error: true }; }
}

export type ShareRow = { id: string; user_id: string; conversation_id: string; created_at: string; revoked_at: string | null; email?: string };

export async function loadShares(db: Db, opts: { page: number; state?: string }): Promise<Paged<ShareRow>> {
  try {
    let qb = db.from("conversation_shares").select("id, user_id, conversation_id, created_at, revoked_at", { count: "exact" });
    if (opts.state === "active") qb = qb.is("revoked_at", null);
    if (opts.state === "revoked") qb = qb.not("revoked_at", "is", null);
    const [a, b] = range(opts.page);
    const { data, count: total, error } = await qb.order("created_at", { ascending: false }).range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as ShareRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id));
    const t = total ?? 0;
    return { rows: rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? "" })), total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}

export type AuditRow = { id: string; actor_email: string; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; created_at: string };
export const AUDIT_ACTIONS = ["user.disable", "user.enable", "share.revoke", "settings.announcement", "settings.maintenance", "settings.features", "cron.run", "export.users", "export.errors"] as const;

export async function loadAudit(db: Db, opts: { page: number; action?: string }): Promise<Paged<AuditRow>> {
  try {
    let qb = db.from("admin_audit_log").select("id, actor_email, action, target_type, target_id, detail, created_at", { count: "exact" });
    if (opts.action && (AUDIT_ACTIONS as readonly string[]).includes(opts.action)) qb = qb.eq("action", opts.action);
    const [a, b] = range(opts.page);
    const { data, count: total, error } = await qb.order("created_at", { ascending: false }).range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const t = total ?? 0;
    return { rows: (data ?? []) as AuditRow[], total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}

export type ActivityRow = { id: string; user_id: string; category: string; title: string; detail: string; status: string | null; created_at: string; email?: string };
export const ACTIVITY_CATEGORIES = ["task", "approval", "outcome", "project", "panel", "connection", "memory"] as const;

/** Everyone's activity_events (what TARGET did for users), newest first. */
export async function loadActivity(db: Db, opts: { page: number; category?: string }): Promise<Paged<ActivityRow>> {
  try {
    let qb = db.from("activity_events").select("id, user_id, category, title, detail, status, created_at", { count: "exact" });
    if (opts.category && (ACTIVITY_CATEGORIES as readonly string[]).includes(opts.category)) qb = qb.eq("category", opts.category);
    const [a, b] = range(opts.page);
    const { data, count: total, error } = await qb.order("created_at", { ascending: false }).range(a, b);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as ActivityRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id));
    const t = total ?? 0;
    return { rows: rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? "" })), total: t, page: opts.page, pages: pages(t), error: false };
  } catch { return { rows: [], total: 0, page: 1, pages: 1, error: true }; }
}
