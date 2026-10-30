import { badRequest, dbError, json, requireUser, unauthorized } from "@/lib/server/auth";
import { APPROVAL_COLS, APPROVAL_STATUSES, type ApprovalStatus } from "@/lib/approvals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const status = new URL(req.url).searchParams.get("status");
  let q = a.db.from("approval_requests").select(APPROVAL_COLS).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(100);
  if (status) { if (!APPROVAL_STATUSES.includes(status as ApprovalStatus)) return badRequest("Unknown status"); q = q.eq("status", status); }
  const { data, error } = await q;
  if (error) return dbError(error, "Could not load approvals");
  return json({ approvals: data });
}
// No POST: approval requests are created only by the server when the assistant proposes an action.
