import { decryptWithAny, decryptionKeys, encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { customModelId, maskKey, normalizeBaseUrl, parseCustomModelId, scrub, CUSTOM_PREFIX } from "@/lib/customProvider";
import { chatUrl, resolveModel, type CustomRoute, type ModelOption } from "@/lib/llm";
import { BlockedAddressError, readCapped, safeFetch } from "@/lib/server/safeFetch";

/**
 * Server side of custom AI providers: sealing the key, loading a user's providers, turning a picker value into
 * a route, and the "Fetch models" / "Test connection" calls. The key is only ever decrypted here, on the server,
 * right before a request to that provider's own base URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };
type Env = Record<string, string | undefined>;

export const PUBLIC_COLS = "id, name, base_url, models, key_preview, created_at, updated_at";
export type CustomProviderRow = { id: string; name: string; base_url: string; models: string[]; key_preview: string; created_at: string; updated_at: string };

/** Seal the API key bound to the owner (a box copied to another user's row won't open). */
export function sealKey(userId: string, apiKey: string, env: Env = process.env): { key_box: string; key_preview: string } {
  return { key_box: encryptSecret(JSON.stringify({ v: 1, u: userId, k: apiKey }), primaryKey(env)), key_preview: maskKey(apiKey) };
}

export function openKey(userId: string, box: string, env: Env = process.env): string {
  const j = JSON.parse(decryptWithAny(box, decryptionKeys(env))) as { u?: string; k?: string };
  if (j.u !== userId || typeof j.k !== "string") throw new Error("Key belongs to a different account");
  return j.k;
}

/** The user's providers (no key material). Empty when the table doesn't exist yet (migration not run). */
export async function listCustomProviders(db: Db, userId: string): Promise<CustomProviderRow[]> {
  try {
    const { data, error } = await db.from("custom_providers").select(PUBLIC_COLS).eq("user_id", userId).order("created_at", { ascending: true });
    return error ? [] : ((data ?? []) as CustomProviderRow[]);
  } catch { return []; }
}

/** Picker options for the user's custom models. */
export function customOptions(rows: CustomProviderRow[]): { id: string; label: string; provider: string; vision: boolean }[] {
  return rows.flatMap((r) => (r.models ?? []).map((m) => ({ id: customModelId(r.id, m), label: `${m.split("/").pop()} · ${r.name}`, provider: "custom", vision: false })));
}

/** True when `value` names one of this user's saved custom models. */
export async function ownsCustomModel(db: Db, userId: string, value: unknown): Promise<boolean> {
  const p = parseCustomModelId(value);
  if (!p) return false;
  const rows = await listCustomProviders(db, userId);
  return rows.some((r) => r.id === p.providerId && r.models.includes(p.model));
}

export type Pick = { builtin: ModelOption | null; custom: CustomRoute | null; id: string | null; error?: string };

/**
 * Turn a picker value into a route. Built-in ids go through the normal allow-list; custom ids must belong to
 * this user and are read with the service-role client (the browser roles can't read key_box). Anything that
 * doesn't resolve means "Auto", exactly like before.
 */
export async function resolvePick(adminDb: Db | null, userId: string, value: unknown, env: Env = process.env): Promise<Pick> {
  if (typeof value !== "string" || !value.startsWith(CUSTOM_PREFIX)) {
    const b = resolveModel(value, env);
    return { builtin: b, custom: null, id: b?.id ?? null };
  }
  const p = parseCustomModelId(value);
  if (!p || !adminDb) return { builtin: null, custom: null, id: null };
  try {
    const { data } = await adminDb.from("custom_providers").select("id, name, base_url, models, key_box").eq("id", p.providerId).eq("user_id", userId).maybeSingle();
    const row = data as { id: string; name: string; base_url: string; models: string[]; key_box: string } | null;
    if (!row || !row.models?.includes(p.model)) return { builtin: null, custom: null, id: null };
    const base = normalizeBaseUrl(row.base_url, env);
    if (!base.ok) return { builtin: null, custom: null, id: null, error: base.error };
    const key = openKey(userId, row.key_box, env);
    return { builtin: null, id: value, custom: { name: row.name, url: chatUrl(base.url), key, model: p.model, fetch: customFetch } };
  } catch {
    return { builtin: null, custom: null, id: null };
  }
}

/** resolvePick with the service-role client created only when the value is a custom model. */
export async function resolveUserPick(userId: string, value: unknown): Promise<Pick> {
  let admin: Db | null = null;
  if (typeof value === "string" && value.startsWith(CUSTOM_PREFIX)) {
    try { const { createAdminClient } = await import("@/lib/supabase/admin"); admin = createAdminClient() as unknown as Db; } catch { admin = null; }
  }
  return resolvePick(admin, userId, value);
}

/** Transport for chat calls to a custom provider: SSRF-guarded, 60 s to first byte, 8 MB per reply. */
export const customFetch: NonNullable<CustomRoute["fetch"]> = (url, init) =>
  safeFetch(url, { method: "POST", headers: init.headers, body: init.body, signal: init.signal, timeoutMs: 60000, maxBytes: 8_000_000 });

const authHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "TARGET/1.0 (+https://gettarget.vercel.app)" });

function netError(e: unknown, name: string): string {
  if (e instanceof BlockedAddressError) return "That address is private or local. Use a public https URL.";
  const n = (e as { name?: string; code?: string })?.name, code = (e as { code?: string })?.code;
  if (n === "TimeoutError" || n === "AbortError") return `${name} didn't answer in time.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "That host name couldn't be found.";
  if ((e as Error)?.message === "Response too large") return `${name} sent a reply that's too large.`;
  return `Couldn't reach ${name}.`;
}

/** GET {base}/models → model ids (max 200). */
export async function fetchModelIds(baseUrl: string, apiKey: string, name = "The provider"): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  try {
    const r = await safeFetch(`${baseUrl}/models`, { headers: authHeaders(apiKey), timeoutMs: 12000, maxBytes: 2_000_000 });
    const text = await readCapped(r, 2_000_000);
    if (r.status >= 300 && r.status < 400) return { ok: false, error: "The provider redirected the request. Use the final API URL." };
    if (r.status === 401 || r.status === 403) return { ok: false, error: `${name} rejected the API key (error ${r.status}).` };
    if (!r.ok) return { ok: false, error: `${name} returned error ${r.status}${text ? `: ${scrub(text, apiKey).slice(0, 120)}` : ""}` };
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { ok: false, error: "The /models reply wasn't JSON. Check the base URL (it usually ends in /v1)." }; }
    const arr = Array.isArray(j) ? j : Array.isArray((j as { data?: unknown })?.data) ? (j as { data: unknown[] }).data : Array.isArray((j as { models?: unknown })?.models) ? (j as { models: unknown[] }).models : null;
    if (!arr) return { ok: false, error: "The /models reply had no model list." };
    const ids = arr.map((m) => (typeof m === "string" ? m : (m as { id?: unknown; name?: unknown })?.id ?? (m as { name?: unknown })?.name))
      .filter((x): x is string => typeof x === "string" && /^[\w.:/@+\-]{1,150}$/.test(x));
    return { ok: true, models: Array.from(new Set(ids)).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: netError(e, name) };
  }
}

/**
 * Test connection: a tiny chat completion with the given model ("Reply with OK", 8 tokens). Without a model,
 * falls back to listing models. Reports time taken and whether tool calling was accepted is NOT probed here
 * (that would spend the user's credits twice); chat falls back to plain replies if tools are refused.
 */
export async function testConnection(baseUrl: string, apiKey: string, model: string | null, name = "The provider"): Promise<{ ok: boolean; ms: number; message: string }> {
  const t0 = Date.now();
  if (!model) {
    const m = await fetchModelIds(baseUrl, apiKey, name);
    return m.ok ? { ok: true, ms: Date.now() - t0, message: `Connected. ${m.models.length} model${m.models.length === 1 ? "" : "s"} found.` } : { ok: false, ms: Date.now() - t0, message: m.error };
  }
  try {
    const r = await safeFetch(chatUrl(baseUrl), {
      method: "POST", headers: { ...authHeaders(apiKey), "Content-Type": "application/json" }, timeoutMs: 30000, maxBytes: 1_000_000,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with just: OK" }], max_tokens: 8, stream: false }),
    });
    const text = await readCapped(r, 1_000_000);
    const ms = Date.now() - t0;
    if (r.status >= 300 && r.status < 400) return { ok: false, ms, message: "The provider redirected the request. Use the final API URL." };
    if (r.status === 401 || r.status === 403) return { ok: false, ms, message: `${name} rejected the API key (error ${r.status}).` };
    if (r.status === 404) return { ok: false, ms, message: `${name} returned 404: check the base URL and the model id "${model}".` };
    if (!r.ok) return { ok: false, ms, message: `${name} returned error ${r.status}${text ? `: ${scrub(text, apiKey).slice(0, 120)}` : ""}` };
    let reply = "";
    try { const j = JSON.parse(text); reply = String(j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text ?? ""); } catch { return { ok: false, ms, message: "The reply wasn't OpenAI-compatible JSON." }; }
    return { ok: true, ms, message: `Connected in ${(ms / 1000).toFixed(1)} s${reply.trim() ? ` · “${scrub(reply, apiKey).slice(0, 40)}”` : ""}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, message: netError(e, name) };
  }
}
