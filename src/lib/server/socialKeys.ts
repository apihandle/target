import { openKey, sealKey } from "@/lib/server/customProviders";
import { GEMINI_MODEL_RE } from "@/lib/socialConfig";

/**
 * The signed-in user's own Gemini API key for social drafting, stored exactly like a custom provider key
 * (lib/server/customProviders.ts + migration 0016): sealed with sealKey() into social_ai_keys.key_box
 * (AES-256-GCM, bound to the owner's user id), only the masked key_preview is ever readable, and all reads
 * of key_box / writes happen here through the service-role client. The key is decrypted only at the moment
 * a draft is generated, and never returned by any function in this module except loadGeminiKey (server-only).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

export const SOCIAL_KEY_SERVICE = "gemini";
const TABLE = "social_ai_keys";
const PUBLIC_COLS = "service, key_preview, model, updated_at";

export type GeminiKeyStatus = { saved: boolean; preview: string; model: string | null };

/** Status for the UI: saved or not, the masked preview and the chosen model. Never any key material. */
export async function geminiKeyStatus(db: Db, userId: string): Promise<GeminiKeyStatus> {
  try {
    const { data, error } = await db.from(TABLE).select(PUBLIC_COLS).eq("user_id", userId).eq("service", SOCIAL_KEY_SERVICE).maybeSingle();
    if (error || !data) return { saved: false, preview: "", model: null };
    return { saved: true, preview: String(data.key_preview ?? ""), model: (data.model as string | null) ?? null };
  } catch {
    return { saved: false, preview: "", model: null };
  }
}

/** Save or replace the user's Gemini key. `apiKey` must already be validated (apiKeyProblem). */
export async function saveGeminiKey(db: Db, userId: string, apiKey: string, model: string | null): Promise<{ preview: string }> {
  const sealed = sealKey(userId, apiKey.trim());
  const cleanModel = model && GEMINI_MODEL_RE.test(model) ? model : null;
  const { error } = await db.from(TABLE).upsert(
    { user_id: userId, service: SOCIAL_KEY_SERVICE, ...sealed, model: cleanModel, updated_at: new Date().toISOString() },
    { onConflict: "user_id,service" },
  );
  if (error) throw new Error("Could not save the key");
  return { preview: sealed.key_preview };
}

/** Remove the user's Gemini key. */
export async function deleteGeminiKey(db: Db, userId: string): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq("user_id", userId).eq("service", SOCIAL_KEY_SERVICE);
  if (error) throw new Error("Could not remove the key");
}

/**
 * The decrypted key + model for a draft call, or null when none is saved (or the row can't be opened).
 * Server-only: the return value must only be passed straight into generateSocialDraft.
 */
export async function loadGeminiKey(db: Db, userId: string): Promise<{ apiKey: string; model: string | null } | null> {
  try {
    const { data, error } = await db.from(TABLE).select("key_box, model").eq("user_id", userId).eq("service", SOCIAL_KEY_SERVICE).maybeSingle();
    if (error || !data?.key_box) return null;
    return { apiKey: openKey(userId, String(data.key_box)), model: (data.model as string | null) ?? null };
  } catch {
    return null;
  }
}
