import { json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { executeApproval } from "@/lib/server/approvals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Runs an action only if its owner already approved it (refuses pending/rejected/foreign requests). */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const r = await executeApproval(a.db, a.user.id, params.id);
  return json(r.body, r.status);
}
