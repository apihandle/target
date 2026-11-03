import { badRequest, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { modelIdSchema } from "@/lib/customProvider";
import { testConnection } from "@/lib/server/customProviders";
import { adminOr503, callTarget, limitCalls, slowDown } from "@/lib/server/customProviderRoutes";

export const dynamic = "force-dynamic";

/** "Test connection": a tiny chat completion ("Reply with just: OK", 8 tokens) with the chosen model. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!(await limitCalls(a.user.id))) return slowDown();
  const b = await readJson(req);
  if (!b) return badRequest("Bad JSON");
  const model = b.model === undefined || b.model === "" ? null : modelIdSchema.safeParse(b.model);
  if (model && !model.success) return badRequest("That model id doesn't look right");
  const admin = adminOr503();
  if (admin instanceof Response) return admin;
  const t = await callTarget(a, admin, b);
  if (!t.ok) return t.res;
  const r = await testConnection(t.baseUrl, t.apiKey, model ? model.data : null, t.name);
  return json(r, r.ok ? 200 : 502);
}
