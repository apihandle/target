import { json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/serviceDb";
import { apiKeyProblem, GEMINI_MODEL_RE, isSocialAiProvider, NVIDIA_MODEL_RE, type SocialAiProvider } from "@/lib/socialConfig";
import { deleteSocialKey, geminiKeyStatus, nvidiaKeyStatus, saveSocialKey } from "@/lib/server/socialKeys";

export const dynamic = "force-dynamic";

/**
 * The caller's own AI API keys for social writing — the user-level twin of /api/admin/social/key,
 * backing the NVIDIA and Gemini cards on /app/connectors (and the key section of the /app/social
 * composer). Two services, one sealed row each (social_ai_keys, migrations 0023 + 0027): "nvidia"
 * (the writer's preferred provider) and "gemini" (the fallback). The key is entered in the app
 * only, stored sealed per user like every provider key (lib/server/socialKeys.ts), and only its
 * masked preview is ever returned. Writes go through the service-role client because migration
 * 0023 grants `authenticated` no INSERT/UPDATE on social_ai_keys; every query is scoped to the
 * caller's own user id.
 *   GET    — both services: saved or not + masked preview + model.
 *   POST   — save/replace { apiKey, model?, provider? } (provider defaults to "gemini", the
 *            original card's contract; the NVIDIA card passes provider: "nvidia").
 *   DELETE — remove one key; the provider comes from ?provider= (default "gemini").
 */
const MODEL_RE: Record<SocialAiProvider, RegExp> = { gemini: GEMINI_MODEL_RE, nvidia: NVIDIA_MODEL_RE };
const SAVE_FAIL_MIGRATION: Record<SocialAiProvider, string> = { gemini: "0023", nvidia: "0027" };

async function bothStatuses(db: ReturnType<typeof serviceDb>, userId: string) {
  return { gemini: await geminiKeyStatus(db, userId), nvidia: await nvidiaKeyStatus(db, userId) };
}

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  return json(await bothStatuses(serviceDb(a.db), a.user.id));
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return json({ error: "Bad JSON" }, 400);
  const provider: SocialAiProvider = isSocialAiProvider(body.provider) ? body.provider : "gemini";
  const problem = apiKeyProblem(body.apiKey);
  if (problem) return json({ error: problem }, 400);
  const modelRaw = typeof body.model === "string" ? body.model.trim() : "";
  if (modelRaw && !MODEL_RE[provider].test(modelRaw)) return json({ error: "That model id doesn't look right." }, 400);
  try {
    await saveSocialKey(serviceDb(a.db), a.user.id, provider, String(body.apiKey), modelRaw || null);
    return json(await bothStatuses(serviceDb(a.db), a.user.id));
  } catch {
    return json({ error: `Could not save the key. If this keeps happening, migration ${SAVE_FAIL_MIGRATION[provider]} may not have run yet.` }, 500);
  }
}

export async function DELETE(req?: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const p = req ? new URL(req.url).searchParams.get("provider") : null;
  const provider: SocialAiProvider = isSocialAiProvider(p) ? p : "gemini";
  try {
    await deleteSocialKey(serviceDb(a.db), a.user.id, provider);
    return json(await bothStatuses(serviceDb(a.db), a.user.id));
  } catch {
    return json({ error: "Could not remove the key." }, 500);
  }
}
