import { json, readJson, type Db } from "@/lib/server/auth";
import { audit, type AuditEntry } from "@/lib/server/adminSettings";
import type { AdminCtx } from "@/lib/server/adminAuth";

/**
 * Shared rules for every admin write:
 * 1. the body must carry confirm: true (the UI only sends it from its confirm dialog), so nothing changes by accident;
 * 2. the audit log entry is written BEFORE the change, and the change is refused when it can't be written
 *    (e.g. migration 0019 not run yet): no unaudited admin writes;
 * 3. a change that then fails gets a second entry with failed: true.
 */
export async function readConfirmed(req: Request): Promise<{ body: Record<string, unknown> } | Response> {
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  if (body.confirm !== true) return json({ error: "Please confirm this action." }, 400);
  return { body };
}

export const AUDIT_UNAVAILABLE = "The admin audit log isn't available. Run supabase/migrations/0019_admin.sql, then try again.";

export async function auditFirst(a: AdminCtx, e: AuditEntry): Promise<Response | null> {
  const ok = await audit(a.db, { id: a.user.id, email: a.user.email }, e);
  return ok ? null : json({ error: AUDIT_UNAVAILABLE }, 503);
}

export async function auditFailure(db: Db, a: AdminCtx, e: AuditEntry, reason: string): Promise<void> {
  await audit(db, { id: a.user.id, email: a.user.email }, { ...e, detail: { ...(e.detail ?? {}), failed: true, reason: reason.slice(0, 200) } });
}
