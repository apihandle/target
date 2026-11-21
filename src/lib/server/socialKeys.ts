import { openKey, sealKey } from "@/lib/server/customProviders";
import { GEMINI_MODEL_RE, NVIDIA_MODEL_RE, type SocialAiProvider } from "@/lib/socialConfig";

/**
 * The signed-in user's own AI API keys for social writing, stored exactly like a custom provider key
 * (lib/server/customProviders.ts + migration 0016): sealed with sealKey() into social_ai_keys.key_box
 * (AES-256-GCM, bound to the owner's user id), only the masked key_preview is ever readable, and all reads
 * of key_box / writes happen here through the service-role client. A key is decrypted only at the moment
 * a draft/post is generated, and never returned by any function in this module except the load* functions
 * (server-only).
 *
 * Two services (one sealed row each, unique (user_id, service)): "gemini" (migration 0023) and "nvidia"
 * (migration 0027). The writer — composer drafts and the Blogger autopilot — resolves through
 * loadSocialWriterKey, which prefers NVIDIA and falls back to Gemini: Vikash's Gemini key kept being
 * rejected by Google, so NVIDIA (build.nvidia.com, OpenAI-compatible) is now the primary writer.
 * Before migration 0027 runs, the table's service check still rejects 'nvidia' rows: saving one throws
 * (the routes answer with the "migration 0027 may not have run yet" message) and reading one finds no
 * row, so everything degrades to the Gemini-only behaviour.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

export const SOCIAL_KEY_SERVICE = "gemini";
export const NVIDIA_KEY_SERVICE = "nvidia";
const TABLE = "social_ai_keys";
const PUBLIC_COLS = "service, key_preview, model, updated_at";

const MODEL_RE: Record<SocialAiProvider, RegExp> = { gemini: GEMINI_MODEL_RE, nvidia: NVIDIA_MODEL_RE };

export type SocialKeyStatus = { saved: boolean; preview: string; model: string | null };
export type GeminiKeyStatus = SocialKeyStatus;

/** Status for the UI: saved or not, the masked preview and the chosen model. Never any key material. */
export async function socialKeyStatus(db: Db, userId: string, service: SocialAiProvider): Promise<SocialKeyStatus> {
  try {
    const { data, error } = await db.from(TABLE).select(PUBLIC_COLS).eq("user_id", userId).eq("service", service).maybeSingle();
    if (error || !data) return { saved: false, preview: "", model: null };
    return { saved: true, preview: String(data.key_preview ?? ""), model: (data.model as string | null) ?? null };
  } catch {
    return { saved: false, preview: "", model: null };
  }
}

/** Save or replace one of the user's service keys. `apiKey` must already be validated (apiKeyProblem). */
export async function saveSocialKey(db: Db, userId: string, service: SocialAiProvider, apiKey: string, model: string | null): Promise<{ preview: string }> {
  const sealed = sealKey(userId, apiKey.trim());
  const cleanModel = model && MODEL_RE[service].test(model) ? model : null;
  const { error } = await db.from(TABLE).upsert(
    { user_id: userId, service, ...sealed, model: cleanModel, updated_at: new Date().toISOString() },
    { onConflict: "user_id,service" },
  );
  if (error) throw new Error("Could not save the key");
  return { preview: sealed.key_preview };
}

/** Remove one of the user's service keys. */
export async function deleteSocialKey(db: Db, userId: string, service: SocialAiProvider): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq("user_id", userId).eq("service", service);
  if (error) throw new Error("Could not remove the key");
}

/**
 * The decrypted key + model for one service, or null when none is saved (or the row can't be opened).
 * Server-only: the return value must only be passed straight into the socialDraft generators.
 */
export async function loadSocialKey(db: Db, userId: string, service: SocialAiProvider): Promise<{ apiKey: string; model: string | null } | null> {
  try {
    const { data, error } = await db.from(TABLE).select("key_box, model").eq("user_id", userId).eq("service", service).maybeSingle();
    if (error || !data?.key_box) return null;
    return { apiKey: openKey(userId, String(data.key_box)), model: (data.model as string | null) ?? null };
  } catch {
    return null;
  }
}

export type SocialWriterKey = { provider: SocialAiProvider; apiKey: string; model: string | null };

/**
 * The key the social writer should use for this user: NVIDIA when an NVIDIA key is saved, else the
 * Gemini key, else null. Every generation path (composer drafts, scheduled auto-generate, the Blogger
 * autopilot) resolves through here so the provider choice lives in exactly one place.
 */
export async function loadSocialWriterKey(db: Db, userId: string): Promise<SocialWriterKey | null> {
  const nvidia = await loadSocialKey(db, userId, NVIDIA_KEY_SERVICE);
  if (nvidia) return { provider: "nvidia", ...nvidia };
  const gemini = await loadSocialKey(db, userId, SOCIAL_KEY_SERVICE);
  if (gemini) return { provider: "gemini", ...gemini };
  return null;
}

/** Gemini wrappers (the original 0023 API — admin routes and older callers keep working unchanged). */
export const geminiKeyStatus = (db: Db, userId: string): Promise<GeminiKeyStatus> => socialKeyStatus(db, userId, SOCIAL_KEY_SERVICE);
export const saveGeminiKey = (db: Db, userId: string, apiKey: string, model: string | null): Promise<{ preview: string }> =>
  saveSocialKey(db, userId, SOCIAL_KEY_SERVICE, apiKey, model);
export const deleteGeminiKey = (db: Db, userId: string): Promise<void> => deleteSocialKey(db, userId, SOCIAL_KEY_SERVICE);
export const loadGeminiKey = (db: Db, userId: string): Promise<{ apiKey: string; model: string | null } | null> =>
  loadSocialKey(db, userId, SOCIAL_KEY_SERVICE);

/** NVIDIA wrappers (migration 0027). */
export const nvidiaKeyStatus = (db: Db, userId: string): Promise<SocialKeyStatus> => socialKeyStatus(db, userId, NVIDIA_KEY_SERVICE);
export const saveNvidiaKey = (db: Db, userId: string, apiKey: string, model: string | null): Promise<{ preview: string }> =>
  saveSocialKey(db, userId, NVIDIA_KEY_SERVICE, apiKey, model);
export const deleteNvidiaKey = (db: Db, userId: string): Promise<void> => deleteSocialKey(db, userId, NVIDIA_KEY_SERVICE);
export const loadNvidiaKey = (db: Db, userId: string): Promise<{ apiKey: string; model: string | null } | null> =>
  loadSocialKey(db, userId, NVIDIA_KEY_SERVICE);
