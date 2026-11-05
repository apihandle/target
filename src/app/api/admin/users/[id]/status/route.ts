import { json } from "@/lib/server/auth";
import { adminNotFound, isAdminEmailListed, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { isUuid } from "@/lib/ids";
import { BAN_DURATION } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

/** Disable or enable a user's sign-in (Supabase auth ban). Never deletes anything. Body: { disabled: boolean, confirm: true }. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { id } = await props.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  if (typeof c.body.disabled !== "boolean") return json({ error: "disabled must be true or false" }, 400);
  const disabled = c.body.disabled;
  if (disabled && id === a.user.id) return json({ error: "You can't disable your own account." }, 400);

  const { data: target, error: getErr } = await a.db.auth.admin.getUserById(id);
  if (getErr || !target?.user) return json({ error: "User not found" }, 404);
  if (disabled && isAdminEmailListed(target.user.email)) return json({ error: "This user is an admin. Remove them from ADMIN_EMAILS first." }, 400);

  const entry = { action: disabled ? "user.disable" : "user.enable", targetType: "user", targetId: id, detail: { email: target.user.email ?? "" } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const { data, error } = await a.db.auth.admin.updateUserById(id, { ban_duration: disabled ? BAN_DURATION : "none" });
  if (error) {
    await auditFailure(a.db, a, entry, error.message ?? "update failed");
    return json({ error: "Could not update the user" }, 502);
  }
  const bannedUntil = (data?.user as { banned_until?: string | null } | undefined)?.banned_until ?? null;
  return json({ ok: true, disabled, banned_until: bannedUntil });
}
