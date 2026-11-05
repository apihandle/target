import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/**
 * Task mode for all of one user's chats. Body: { on: boolean, confirm: true }. Off is the safe direction; on is the
 * owner's call (payments and deletes still wait for the user's card either way). Returns how many chats changed.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { id } = await props.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  if (typeof c.body.on !== "boolean") return json({ error: "on must be true or false" }, 400);
  const on = c.body.on;
  const entry = { action: on ? "user.task_mode_on" : "user.task_mode_off", targetType: "user", targetId: id };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const { data, error } = await a.db.from("conversations").update({ task_mode: on }).eq("user_id", id).eq("task_mode", !on).select("id");
  if (error) { await auditFailure(a.db, a, entry, error.message ?? "update failed"); return json({ error: "Could not change Task mode" }, 502); }
  return json({ ok: true, on, changed: data?.length ?? 0 });
}
