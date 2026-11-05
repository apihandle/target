import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { FEEDBACK_LIMIT, MY_FEEDBACK_PAGE, validateFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * Feedback from signed-in users (migration 0020). Uses the user's own session client, so RLS lets them insert and
 * read only their own rows; admin_note is never selected or settable from here. 10 per hour per user, 2000 chars max.
 */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await checkLimit({ key: `feedback:${a.user.id}`, ...FEEDBACK_LIMIT }))) {
    return json({ error: "You've sent a lot of feedback in the last hour. Thank you! Please try again a bit later." }, 429);
  }
  const v = validateFeedback(await readJson(req));
  if (!v.ok) return badRequest(v.error);
  const { data, error } = await a.db.from("feedback").insert({ user_id: a.user.id, ...v.value }).select("id, created_at").single();
  if (error || !data) return dbError(error, "Couldn't send your feedback. Please try again.");
  return json({ ok: true, id: data.id, created_at: data.created_at }, 201);
}

/** The user's own feedback, newest first. ?page=1.. (10 per page). */
export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const n = Number(new URL(req.url).searchParams.get("page") ?? "1");
  const page = Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
  const from = (page - 1) * MY_FEEDBACK_PAGE;
  const { data, error, count } = await a.db.from("feedback")
    .select("id, message, category, page_path, status, created_at", { count: "exact" })
    .eq("user_id", a.user.id).order("created_at", { ascending: false }).range(from, from + MY_FEEDBACK_PAGE - 1);
  if (error) return dbError(error, "Couldn't load your feedback");
  const total = count ?? 0;
  return json({ items: data ?? [], page, total, more: from + (data?.length ?? 0) < total });
}
