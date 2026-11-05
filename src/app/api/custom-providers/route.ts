import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { MAX_CUSTOM_PROVIDERS, providerInput, uniqueModels } from "@/lib/customProvider";
import { listCustomProviders, PUBLIC_COLS, sealKey } from "@/lib/server/customProviders";
import { adminOr503, checkBaseUrl, limitEdits, slowDown } from "@/lib/server/customProviderRoutes";
import { featureOn } from "@/lib/server/adminSettings";
import { DISABLED_MESSAGE } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

/** The signed-in user's own AI providers. The API key is never returned, only a masked preview. */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  return json({ providers: await listCustomProviders(a.db, a.user.id) });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await featureOn("custom_providers"))) return json({ error: DISABLED_MESSAGE.custom_providers, disabled: true }, 403);
  if (!(await limitEdits(a.user.id))) return slowDown();
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  const v = providerInput.safeParse({ ...b, models: Array.isArray(b.models) ? uniqueModels(b.models.filter((m): m is string => typeof m === "string")) : b.models });
  if (!v.success) return json({ error: v.error.issues[0]?.message ?? "Check the details", field: String(v.error.issues[0]?.path[0] ?? "") }, 400);
  const url = await checkBaseUrl(v.data.baseUrl);
  if (!url.ok) return json({ error: url.error, field: "baseUrl" }, 400);
  const admin = adminOr503();
  if (admin instanceof Response) return admin;
  const { count } = await admin.from("custom_providers").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= MAX_CUSTOM_PROVIDERS) return badRequest(`You can add up to ${MAX_CUSTOM_PROVIDERS} providers. Delete one first.`);
  const { data, error } = await admin.from("custom_providers")
    .insert({ user_id: a.user.id, name: v.data.name, base_url: url.url, models: v.data.models, ...sealKey(a.user.id, v.data.apiKey) })
    .select(PUBLIC_COLS).single();
  if (error || !data) return dbError(error, "Could not save the provider");
  return json({ provider: data }, 201);
}
