import { badRequest, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { fetchModelIds } from "@/lib/server/customProviders";
import { adminOr503, callTarget, limitCalls, slowDown } from "@/lib/server/customProviderRoutes";

export const dynamic = "force-dynamic";

/** "Fetch models": GET {baseURL}/models on the server (SSRF-guarded) and return the model ids. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await limitCalls(a.user.id))) return slowDown();
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  const admin = adminOr503();
  if (admin instanceof Response) return admin;
  const t = await callTarget(a, admin, b);
  if (!t.ok) return t.res;
  const r = await fetchModelIds(t.baseUrl, t.apiKey, t.name);
  return r.ok ? json({ models: r.models }) : json({ error: r.error }, 502);
}
