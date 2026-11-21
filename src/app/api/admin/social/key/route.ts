import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { apiKeyProblem, GEMINI_MODEL_RE, isSocialAiProvider, NVIDIA_MODEL_RE, type SocialAiProvider } from "@/lib/socialConfig";
import { deleteSocialKey, geminiKeyStatus, nvidiaKeyStatus, saveSocialKey, socialKeyStatus } from "@/lib/server/socialKeys";

export const dynamic = "force-dynamic";

/**
 * Save/replace or remove the caller's own AI API key for social writing — one sealed row per
 * service in social_ai_keys ("gemini", migration 0023; "nvidia", migration 0027 — the writer
 * prefers NVIDIA, see lib/server/socialKeys.ts). The service comes from the body's `provider`
 * field (default "gemini", the original contract). Admin writes: confirm: true required, audited
 * first, and the audit detail carries only the masked preview. The key itself is never returned,
 * logged or audited.
 */
const MODEL_RE: Record<SocialAiProvider, RegExp> = { gemini: GEMINI_MODEL_RE, nvidia: NVIDIA_MODEL_RE };
const SAVE_FAIL_MIGRATION: Record<SocialAiProvider, string> = { gemini: "0023", nvidia: "0027" };

export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const provider: SocialAiProvider = isSocialAiProvider(c.body.provider) ? c.body.provider : "gemini";
  const problem = apiKeyProblem(c.body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const modelRaw = typeof c.body.model === "string" ? c.body.model.trim() : "";
  if (modelRaw && !MODEL_RE[provider].test(modelRaw)) return json({ error: "That model id doesn't look right." }, 400);
  const before = await socialKeyStatus(a.db, a.user.id, provider);
  const entry = { action: `social.${provider}_key.save`, targetType: "social_ai_key", targetId: a.user.id, detail: { provider, replaced: before.saved } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    const { preview } = await saveSocialKey(a.db, a.user.id, provider, String(c.body.apiKey), modelRaw || null);
    const status = { saved: true, preview, model: modelRaw || null };
    return json(provider === "nvidia"
      ? { gemini: await geminiKeyStatus(a.db, a.user.id), nvidia: status }
      : { gemini: status, nvidia: await nvidiaKeyStatus(a.db, a.user.id) });
  } catch {
    await auditFailure(a.db, a, entry, "save failed");
    return json({ error: `Could not save the key. If this keeps happening, migration ${SAVE_FAIL_MIGRATION[provider]} may not have run yet.` }, 500);
  }
}

export async function DELETE(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const provider: SocialAiProvider = isSocialAiProvider(c.body.provider) ? c.body.provider : "gemini";
  const entry = { action: `social.${provider}_key.delete`, targetType: "social_ai_key", targetId: a.user.id, detail: { provider } };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  try {
    await deleteSocialKey(a.db, a.user.id, provider);
    return json({ gemini: await geminiKeyStatus(a.db, a.user.id), nvidia: await nvidiaKeyStatus(a.db, a.user.id) });
  } catch {
    await auditFailure(a.db, a, entry, "delete failed");
    return json({ error: "Could not remove the key." }, 500);
  }
}
