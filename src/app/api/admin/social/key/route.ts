import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { apiKeyProblem, GEMINI_MODEL_RE } from "@/lib/socialConfig";
import { deleteGeminiKey, geminiKeyStatus, saveGeminiKey } from "@/lib/server/socialKeys";

export const dynamic = "force-dynamic";

/**
 * Save/replace or remove the caller's own Gemini API key (stored sealed per user, like a custom provider
 * key — see lib/server/socialKeys.ts). Admin writes: confirm: true required, audited first, and the audit
 * detail carries only the masked preview. The key itself is never returned, logged or audited.
 */
export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const problem = apiKeyProblem(c.body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const modelRaw = typeof c.body.model === "string" ? c.body.model.trim() : "";
  if (modelRaw && !GEMINI_MODEL_RE.test(modelRaw)) return json({ error: "That model id doesn't look right (letters, numbers, dots and dashes)." }, 400);
  const before = await geminiKeyStatus(a.db, a.user.id);
  const entry = { action: "social.gemini_key.save", targetType: "social_ai_key", targetId: a.user.id, detail: { replaced: before.saved } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    const { preview } = await saveGeminiKey(a.db, a.user.id, String(c.body.apiKey), modelRaw || null);
    return json({ gemini: { saved: true, preview, model: modelRaw || null } });
  } catch {
    await auditFailure(a.db, a, entry, "save failed");
    return json({ error: "Could not save the key. If this keeps happening, migration 0023 may not have run yet." }, 500);
  }
}

export async function DELETE(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const entry = { action: "social.gemini_key.delete", targetType: "social_ai_key", targetId: a.user.id, detail: {} };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    await deleteGeminiKey(a.db, a.user.id);
    return json({ gemini: { saved: false, preview: "", model: null } });
  } catch {
    await auditFailure(a.db, a, entry, "delete failed");
    return json({ error: "Could not remove the key." }, 500);
  }
}
