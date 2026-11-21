import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { apiKeyProblem, GEMINI_MODEL_RE } from "@/lib/socialConfig";
import { deleteGeminiKey, geminiKeyStatus, saveGeminiKey } from "@/lib/server/socialKeys";

export const dynamic = "force-dynamic";

/**
 * The caller's own Gemini API key for social drafting — the user-level twin of
 * /api/admin/social/key, backing the Gemini card on /app/connectors (and the key section of the
 * /app/social composer). The key is entered in the app only, stored sealed per user like every
 * provider key (lib/server/socialKeys.ts), and only its masked preview is ever returned. Writes go
 * through the service-role client because migration 0023 grants `authenticated` no INSERT/UPDATE on
 * social_ai_keys; every query is scoped to the caller's own user id.
 *   GET    — saved or not + masked preview + model.
 *   POST   — save/replace { apiKey, model? }.
 *   DELETE — remove the key.
 */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  return json({ gemini: await geminiKeyStatus(serviceDb(a.db), a.user.id) });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const problem = apiKeyProblem(body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const modelRaw = typeof body.model === "string" ? body.model.trim() : "";
  if (modelRaw && !GEMINI_MODEL_RE.test(modelRaw)) return json({ error: "That model id doesn't look right (letters, numbers, dots and dashes)." }, 400);
  try {
    const { preview } = await saveGeminiKey(serviceDb(a.db), a.user.id, String(body.apiKey), modelRaw || null);
    return json({ gemini: { saved: true, preview, model: modelRaw || null } });
  } catch {
    return json({ error: "Could not save the key. If this keeps happening, migration 0023 may not have run yet." }, 500);
  }
}

export async function DELETE() {
  const a = await requireUser();
  if (!a) return unauthorized();
  try {
    await deleteGeminiKey(serviceDb(a.db), a.user.id);
    return json({ gemini: { saved: false, preview: "", model: null } });
  } catch {
    return json({ error: "Could not remove the key." }, 500);
  }
}
