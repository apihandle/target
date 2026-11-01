import { badRequest, json, notFound, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLimit, tooMany } from "@/lib/connectors/rateLimit";
import { appendInput, helpInput } from "@/lib/browserHelp";

export const dynamic = "force-dynamic";

/**
 * Captcha hand-off, owner only. GET: the screenshot the worker is waiting on. POST: one tap, text, key or "done",
 * which the worker repeats on the real page in order.
 */
async function load(id: string) {
  const a = await requireUser();
  if (!a) return { res: unauthorized() };
  if (!isUuid(id)) return { res: notFound() };
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return { res: json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503) }; }
  const { data } = await db.from("browser_jobs").select("id, status, help, help_inputs").eq("id", id).eq("user_id", a.user.id).maybeSingle();
  if (!data) return { res: notFound() };
  return { a, db, job: data as { id: string; status: string; help: Record<string, unknown> | null; help_inputs: unknown } };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = await load(params.id);
  if ("res" in r) return r.res;
  const h = r.job.status === "running" ? r.job.help : null;
  return new Response(JSON.stringify({ help: h ? { reason: h.reason, screenshot: h.screenshot, w: h.w, h: h.h, at: h.at } : null }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const r = await load(params.id);
  if ("res" in r) return r.res;
  if (r.job.status !== "running" || !r.job.help) return json({ error: "This task isn't waiting for you any more" }, 409);
  if (!(await checkLimit({ key: `browser-help:${r.a.user.id}`, limit: 90, windowSec: 60 }))) return tooMany();
  const p = helpInput.safeParse(await readJson(req));
  if (!p.success) return badRequest("Send a tap, some text, a key, or done");
  const inputs = appendInput(r.job.help_inputs, p.data);
  await r.db.from("browser_jobs").update({ help_inputs: inputs }).eq("id", r.job.id).eq("user_id", r.a.user.id);
  return json({ ok: true, seq: inputs[inputs.length - 1].seq });
}
