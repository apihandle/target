/**
 * User feedback (table feedback, migration 0020). Pure definitions shared by /api/feedback, /api/admin/feedback,
 * the /app form and tests.
 */

export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ["new", "seen", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = { bug: "Bug", idea: "Idea", other: "Other" };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "New", seen: "Seen", done: "Done" };

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 2000;
export const NOTE_MAX = 1000;
/** Abuse limit, not a quota: 10 messages per user per hour. */
export const FEEDBACK_LIMIT = { limit: 10, windowSec: 3600 };
export const MY_FEEDBACK_PAGE = 10;

export const isCategory = (v: unknown): v is FeedbackCategory => typeof v === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(v);
export const isStatus = (v: unknown): v is FeedbackStatus => typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v);

/** The app path the feedback was sent from: same-origin path only, no query or hash, at most 200 chars. */
export function cleanPagePath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const path = v.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 200) return null;
  return /^[A-Za-z0-9/_\-.~%]+$/.test(path) ? path : null;
}

export type FeedbackInput = { message: string; category: FeedbackCategory; page_path: string | null };

export function validateFeedback(body: Record<string, unknown> | null): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Bad JSON" };
  // Control characters (except newlines and tabs) are dropped; the text is stored as plain text and shown as text.
  const message = typeof body.message === "string" ? body.message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim() : "";
  if (message.length < FEEDBACK_MIN) return { ok: false, error: "Please write a few words." };
  if (message.length > FEEDBACK_MAX) return { ok: false, error: `Please keep it under ${FEEDBACK_MAX} characters.` };
  const category = body.category === undefined ? "other" : body.category;
  if (!isCategory(category)) return { ok: false, error: "Pick Bug, Idea or Other." };
  return { ok: true, value: { message, category, page_path: cleanPagePath(body.page_path) } };
}
