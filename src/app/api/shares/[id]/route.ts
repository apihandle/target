import { dbError, json, notFound, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** Revoke a share link. The public page stops working immediately; revoking twice is harmless. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const { data: row } = await a.db.from("conversation_shares").select("id, revoked_at").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!row) return notFound();
  if (row.revoked_at) return json({ ok: true, revoked_at: row.revoked_at });
  const revoked_at = new Date().toISOString();
  const { data, error } = await a.db.from("conversation_shares").update({ revoked_at }).eq("id", params.id).eq("user_id", a.user.id).select("id");
  if (error) return dbError(error, "Could not revoke the link");
  if (!data?.length) return notFound();
  await logActivity(a.db, a.user.id, { category: "outcome", title: "Share link revoked" });
  return json({ ok: true, revoked_at });
}
