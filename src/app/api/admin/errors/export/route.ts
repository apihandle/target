import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFirst } from "@/lib/server/adminWrite";
import { loadErrors } from "@/lib/server/adminData";
import { toCsv } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

/** CSV of error_events, newest first, same ?source= / ?q= filters as the page (max 5000 rows). Recorded in the audit log. */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const sp = new URL(req.url).searchParams;
  const source = sp.get("source") ?? undefined;
  const q = (sp.get("q") ?? "").slice(0, 100);
  const r = await loadErrors(a.db, { page: 1, source, q, limit: MAX_ROWS });
  if (r.error) return json({ error: "Could not load errors" }, 502);
  const blocked = await auditFirst(a, { action: "export.errors", targetType: "export", targetId: "errors", detail: { rows: r.rows.length, source: source ?? "", q } });
  if (blocked) return blocked;
  const csv = toCsv(["id", "created_at", "source", "message", "url", "user_id", "fingerprint", "stack"],
    r.rows.map((e) => [e.id, e.created_at, e.source, e.message, e.url ?? "", e.user_id ?? "", e.fingerprint, e.stack ?? ""]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="target-errors-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
