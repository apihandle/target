import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFirst } from "@/lib/server/adminWrite";
import { cleanFeedbackFilters, loadFeedback } from "@/lib/server/adminFeedback";
import { toCsv } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

/** CSV of feedback, newest first, same ?status= / ?category= / ?q= filters as the page (max 5000 rows). Audited. */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const sp = new URL(req.url).searchParams;
  const f = cleanFeedbackFilters({ status: sp.get("status") ?? undefined, category: sp.get("category") ?? undefined, q: sp.get("q") ?? undefined });
  const r = await loadFeedback(a.db, { ...f, page: 1, limit: MAX_ROWS });
  if (r.error) return json({ error: "Could not load feedback" }, 502);
  const blocked = await auditFirst(a, { action: "export.feedback", targetType: "export", targetId: "feedback", detail: { rows: r.rows.length, status: f.status ?? "", category: f.category ?? "", q: f.q ?? "" } });
  if (blocked) return blocked;
  const csv = toCsv(["id", "created_at", "status", "category", "user_id", "email", "page_path", "message", "admin_note", "updated_at"],
    r.rows.map((x) => [x.id, x.created_at, x.status, x.category, x.user_id, x.email, x.page_path ?? "", x.message, x.admin_note ?? "", x.updated_at]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="target-feedback-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
