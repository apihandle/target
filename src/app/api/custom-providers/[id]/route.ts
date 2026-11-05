import { badRequest, dbError, json, notFound, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { CUSTOM_PREFIX, providerPatch, uniqueModels } from "@/lib/customProvider";
import { PUBLIC_COLS, sealKey } from "@/lib/server/customProviders";
import { adminOr503, checkBaseUrl, limitEdits, sameHost, slowDown } from "@/lib/server/customProviderRoutes";
import { featureOn } from "@/lib/server/adminSettings";
import { DISABLED_MESSAGE } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

/** Edit name, base URL, models or key. Leaving the key empty keeps the saved one (only for the same host). */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await featureOn("custom_providers"))) return json({ error: DISABLED_MESSAGE.custom_providers, disabled: true }, 403);
  if (!isUuid(id)) return notFound();
  if (!(await limitEdits(a.user.id))) return slowDown();
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  const input = { ...b } as Record<string, unknown>;
  if (typeof input.apiKey === "string" && !input.apiKey.trim()) delete input.apiKey;
  if (Array.isArray(input.models)) input.models = uniqueModels(input.models.filter((m): m is string => typeof m === "string"));
  const v = providerPatch.safeParse(input);
  if (!v.success) return json({ error: v.error.issues[0]?.message ?? "Check the details", field: String(v.error.issues[0]?.path[0] ?? "") }, 400);
  const admin = adminOr503();
  if (admin instanceof Response) return admin;
  const { data: cur } = await admin.from("custom_providers").select("id, base_url, models").eq("id", id).eq("user_id", a.user.id).maybeSingle();
  if (!cur) return notFound();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.name !== undefined) patch.name = v.data.name;
  if (v.data.models !== undefined) patch.models = v.data.models;
  if (v.data.baseUrl !== undefined) {
    const url = await checkBaseUrl(v.data.baseUrl);
    if (!url.ok) return json({ error: url.error, field: "baseUrl" }, 400);
    // The saved key is never sent to a different host without the user typing it again.
    if (!v.data.apiKey && !sameHost(url.url, (cur as { base_url: string }).base_url)) return json({ error: "Enter the API key again for the new address.", field: "apiKey" }, 400);
    patch.base_url = url.url;
  }
  if (v.data.apiKey) Object.assign(patch, sealKey(a.user.id, v.data.apiKey));
  const { data, error } = await admin.from("custom_providers").update(patch).eq("id", id).eq("user_id", a.user.id).select(PUBLIC_COLS).single();
  if (error || !data) return dbError(error, "Could not save the provider");
  // A removed model that was the remembered pick goes back to Auto.
  if (v.data.models) await resetPickIfGone(a.db, a.user.id, id, v.data.models);
  return json({ provider: data });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(id)) return notFound();
  const { data } = await a.db.from("custom_providers").delete().eq("id", id).eq("user_id", a.user.id).select("id");
  if (!data?.length) return notFound();
  await resetPickIfGone(a.db, a.user.id, id, []);
  return json({ ok: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resetPickIfGone(db: { from: (t: string) => any }, userId: string, providerId: string, models: string[]) {
  try {
    const { data } = await db.from("user_settings").select("preferred_model").eq("user_id", userId).maybeSingle();
    const pm = (data as { preferred_model?: string | null } | null)?.preferred_model;
    const prefix = `${CUSTOM_PREFIX}${providerId}:`;
    if (typeof pm === "string" && pm.startsWith(prefix) && !models.includes(pm.slice(prefix.length)))
      await db.from("user_settings").update({ preferred_model: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
  } catch { /* best effort: an unknown pick already falls back to Auto */ }
}
