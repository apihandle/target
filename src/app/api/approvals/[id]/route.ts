import { badRequest, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { APPROVAL_COLS } from "@/lib/approvals";
import { isUuid } from "@/lib/ids";
import { decideApproval } from "@/lib/server/approvals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data } = await a.db.from("approval_requests").select(APPROVAL_COLS).eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!data) return notFound();
  const { decided_by: _omit, ...rest } = data as Record<string, unknown>; void _omit;
  return json({ approval: rest });
}

/** The user's decision: { decision: "approve" | "reject" }. Approve runs the action server-side. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const body = await readJson(req);
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "reject") return badRequest("decision must be approve or reject");
  const r = await decideApproval(a.db, a.user.id, params.id, decision);
  return json(r.body, r.status);
}
