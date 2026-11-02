import { badRequest, json, notFound, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, primaryKey } from "@/lib/connectors/crypto";
import { checkLimit } from "@/lib/connectors/rateLimit";
import { cleanCode } from "@/lib/signin";

export const dynamic = "force-dynamic";

/**
 * The owner types the one-time code a site sent while TARGET signs in for them. The code is sealed
 * and only handed to the browser worker running that same job, once; it is never shown to the AI.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  if (!(await checkLimit({ key: `job-code:${a.user.id}`, limit: 10, windowSec: 600 }))) return json({ error: "Too many tries. Wait a few minutes." }, 429);
  const b = await readJson(req);
  const code = cleanCode(b?.code);
  if (!code) return badRequest("Enter the code exactly as the site sent it");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  const { data: job } = await db.from("browser_jobs").select("id, status, inputs").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!job) return notFound();
  if (job.status !== "running") return json({ error: "This sign-in isn't waiting for a code any more" }, 409);
  const inputs = (job.inputs && typeof job.inputs === "object" && !Array.isArray(job.inputs) ? job.inputs : {}) as Record<string, unknown>;
  if (!inputs.signin) return badRequest("Not a sign-in");
  await db.from("browser_jobs").update({ inputs: { ...inputs, code_box: encryptSecret(code, primaryKey()) } }).eq("id", params.id).eq("user_id", a.user.id);
  return json({ ok: true });
}
