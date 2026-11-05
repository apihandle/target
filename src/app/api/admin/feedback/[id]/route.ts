import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { clearNavCache } from "@/lib/server/adminStats";
import { isUuid } from "@/lib/ids";
import { NOTE_MAX, isStatus } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * Change a feedback item's status and/or admin note. Body: { confirm: true, status?: "new"|"seen"|"done", note?: string }.
 * Audit entry first (refused if the log is unavailable), like every admin write. The note is internal: users never see it.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { id } = await props.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const { status, note } = c.body;
  if (status !== undefined && !isStatus(status)) return json({ error: "Status must be new, seen or done." }, 400);
  if (note !== undefined && note !== null && typeof note !== "string") return json({ error: "Bad note" }, 400);
  const cleanNote = typeof note === "string" ? note.trim() : note === null ? "" : undefined;
  if (cleanNote !== undefined && cleanNote.length > NOTE_MAX) return json({ error: `Keep the note under ${NOTE_MAX} characters.` }, 400);
  if (status === undefined && cleanNote === undefined) return json({ error: "Nothing to change" }, 400);

  const { data: row, error: readErr } = await a.db.from("feedback").select("id, user_id, status, admin_note").eq("id", id).maybeSingle();
  if (readErr) return json({ error: "Could not load the feedback (has migration 0020 run?)" }, 500);
  if (!row) return json({ error: "Not found" }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (cleanNote !== undefined) patch.admin_note = cleanNote || null;
  // The audit detail records what changed, not the user's message; the note length only, not its text.
  const entry = { action: "feedback.update", targetType: "feedback", targetId: id, detail: { owner: row.user_id, from: row.status, ...(status !== undefined ? { status } : {}), ...(cleanNote !== undefined ? { note_chars: cleanNote.length } : {}) } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const { data, error } = await a.db.from("feedback").update(patch).eq("id", id).select("id, status, admin_note, updated_at");
  if (error || !data?.length) {
    await auditFailure(a.db, a, entry, error?.message ?? "no row updated");
    return json({ error: "Could not update the feedback" }, 502);
  }
  clearNavCache();
  return json({ ok: true, feedback: data[0] });
}
