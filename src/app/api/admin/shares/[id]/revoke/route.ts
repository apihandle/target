import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Revoke a /share link (sets revoked_at; the link stops working at once and can't be revived). Body: { confirm: true }. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { id } = await props.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const { data: row, error: readErr } = await a.db.from("conversation_shares").select("id, user_id, revoked_at").eq("id", id).maybeSingle();
  if (readErr) return json({ error: "Could not load the share link" }, 500);
  if (!row) return json({ error: "Not found" }, 404);
  if (row.revoked_at) return json({ ok: true, revoked_at: row.revoked_at, already: true });
  const entry = { action: "share.revoke", targetType: "share", targetId: id, detail: { owner: row.user_id } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const revoked_at = new Date().toISOString();
  const { data, error } = await a.db.from("conversation_shares").update({ revoked_at }).eq("id", id).is("revoked_at", null).select("id");
  if (error || !data?.length) {
    await auditFailure(a.db, a, entry, error?.message ?? "no row updated");
    return json({ error: "Could not revoke the link" }, 502);
  }
  return json({ ok: true, revoked_at });
}
