import type { Db } from "@/lib/server/auth";
import { emailsFor, likeTerm } from "@/lib/server/adminData";
import { PAGE_SIZE } from "@/lib/adminConfig";
import { isCategory, isStatus, type FeedbackCategory, type FeedbackStatus } from "@/lib/feedback";

/** /admin → Feedback (table feedback, migration 0020). Service-role client from requireAdmin() only. */

export type FeedbackRow = {
  id: string; user_id: string; message: string; category: FeedbackCategory; page_path: string | null;
  status: FeedbackStatus; admin_note: string | null; created_at: string; updated_at: string;
};
export type FeedbackFilters = { status?: string; category?: string; q?: string };

export function cleanFeedbackFilters(raw: Record<string, string | undefined>): FeedbackFilters {
  return {
    status: isStatus(raw.status) ? raw.status : undefined,
    category: isCategory(raw.category) ? raw.category : undefined,
    q: raw.q ? raw.q.trim().slice(0, 100) || undefined : undefined,
  };
}

const COLS = "id, user_id, message, category, page_path, status, admin_note, created_at, updated_at";
type Q = { eq(k: string, v: unknown): Q; ilike(k: string, v: string): Q };
function applyFilters<T>(q: T, f: FeedbackFilters): T {
  let x = q as unknown as Q;
  if (f.status) x = x.eq("status", f.status);
  if (f.category) x = x.eq("category", f.category);
  if (f.q) x = x.ilike("message", likeTerm(f.q));
  return x as unknown as T;
}

export async function loadFeedback(db: Db, opts: FeedbackFilters & { page: number; limit?: number }): Promise<{ rows: (FeedbackRow & { email: string })[]; total: number; page: number; pages: number; error: boolean }> {
  const per = opts.limit ?? PAGE_SIZE;
  try {
    const { count, error: cErr } = await (applyFilters(db.from("feedback").select("id", { count: "exact", head: true }), opts) as unknown as PromiseLike<{ count: number | null; error: unknown }>);
    if (cErr) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const total = count ?? 0;
    const pages = Math.max(1, Math.ceil(total / per));
    const page = Math.min(Math.max(1, opts.page), pages);
    const { data, error } = await applyFilters(db.from("feedback").select(COLS), opts).order("created_at", { ascending: false }).range((page - 1) * per, page * per - 1);
    if (error) return { rows: [], total: 0, page: 1, pages: 1, error: true };
    const rows = (data ?? []) as FeedbackRow[];
    const emails = await emailsFor(db, rows.map((r) => r.user_id));
    return { rows: rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? "" })), total, page, pages, error: false };
  } catch {
    return { rows: [], total: 0, page: 1, pages: 1, error: true };
  }
}

/** Counts by status for the filter chips (null when the table isn't readable). */
export async function feedbackCounts(db: Db): Promise<Record<FeedbackStatus, number> | null> {
  try {
    const one = async (s: FeedbackStatus) => {
      const { count, error } = await db.from("feedback").select("id", { count: "exact", head: true }).eq("status", s);
      if (error) throw new Error("unreadable");
      return count ?? 0;
    };
    const [n, s, d] = await Promise.all([one("new"), one("seen"), one("done")]);
    return { new: n, seen: s, done: d };
  } catch { return null; }
}
