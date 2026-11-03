import { json, type Authed, type Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasEncryptionKey } from "@/lib/connectors/crypto";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { isUuid } from "@/lib/ids";
import { normalizeBaseUrl } from "@/lib/customProvider";
import { openKey } from "@/lib/server/customProviders";
import { resolvesPublic } from "@/lib/server/safeFetch";

/** Shared checks for the /api/custom-providers routes. */
export const limitEdits = (uid: string) => checkLimit({ key: `customai-edit:${uid}`, limit: 30, windowSec: 600 });
export const limitCalls = (uid: string) => checkLimit({ key: `customai-call:${uid}`, limit: 30, windowSec: 600 });
export const slowDown = () => json({ error: "Too many requests. Try again in a few minutes." }, 429);

export function adminOr503(): Db | Response {
  if (!hasEncryptionKey()) return json({ error: "Custom providers aren't set up on this server yet (encryption key missing)." }, 503);
  try { return createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
}

/** Normalise the URL and make sure its host resolves only to public addresses. */
export async function checkBaseUrl(raw: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const n = normalizeBaseUrl(raw);
  if (!n.ok) return n;
  if (!(await resolvesPublic(new URL(n.url).hostname))) return { ok: false, error: "That host doesn't resolve to a public address." };
  return n;
}

const hostOf = (u: string) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };
export const sameHost = (a: string, b: string) => hostOf(a) === hostOf(b) && hostOf(a) !== "";

/**
 * What a "Fetch models" / "Test connection" call talks to: the form's URL + key, or a saved provider
 * (optionally with a new URL or key from the edit form). A saved key is never sent to a different host.
 */
export async function callTarget(a: Authed, admin: Db, b: Record<string, unknown>): Promise<{ ok: true; baseUrl: string; apiKey: string; name: string } | { ok: false; res: Response }> {
  const bad = (error: string, status = 400) => ({ ok: false as const, res: json({ error }, status) });
  const newKey = typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : null;
  if (newKey && (newKey.length > 500 || /\s/.test(newKey))) return bad("That API key doesn't look right");
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : "The provider";
  if (b.id !== undefined) {
    if (!isUuid(b.id)) return bad("Not found", 404);
    const { data } = await admin.from("custom_providers").select("id, name, base_url, key_box").eq("id", b.id).eq("user_id", a.user.id).maybeSingle();
    const row = data as { name: string; base_url: string; key_box: string } | null;
    if (!row) return bad("Not found", 404);
    const url = await checkBaseUrl(b.baseUrl ?? row.base_url);
    if (!url.ok) return bad(url.error);
    if (!newKey && !sameHost(url.url, row.base_url)) return bad("Enter the API key again for the new address.");
    let key = newKey;
    if (!key) { try { key = openKey(a.user.id, row.key_box); } catch { return bad("The saved key can't be opened. Enter it again.", 409); } }
    return { ok: true, baseUrl: url.url, apiKey: key, name: row.name };
  }
  if (!newKey) return bad("Enter the API key");
  const url = await checkBaseUrl(b.baseUrl);
  if (!url.ok) return bad(url.error);
  return { ok: true, baseUrl: url.url, apiKey: newKey, name };
}
