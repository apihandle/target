import { badRequest, json, notFound, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextControl, PAUSE_MS, type Control } from "@/lib/liveView";

export const dynamic = "force-dynamic";

/**
 * The owner drives a running browser task from the chat panel:
 *   take     -> the agent pauses; the user clicks and types in the live view (up to 5 minutes)
 *   continue -> control goes back to the agent, which reads the page again and carries on
 *   stop     -> the task ends ("Stopped by you"); a queued task is cancelled straight away
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const b = await readJson(req);
  const action = b?.action;
  if (action !== "take" && action !== "continue" && action !== "stop") return badRequest("action must be take, continue or stop");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  const { data: job } = await db.from("browser_jobs").select("id, status, live, control, paused_until").eq("id", params.id).eq("user_id", a.user.id).maybeSingle();
  if (!job) return notFound();
  // A paused job is briefly "queued" while it moves to the next worker run; it keeps its control state.
  const handingOver = job.status === "queued" && (job.control === "paused" || job.control === "user");
  if (action === "stop" && job.status === "queued" && !handingOver) {
    const { data } = await db.from("browser_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", params.id).eq("user_id", a.user.id).eq("status", "queued").select("id");
    return data?.length ? json({ status: "cancelled" }) : json({ error: "This task can't be changed now" }, 409);
  }
  if (job.status !== "running" && !handingOver) return json({ error: "This task isn't running" }, 409);
  const interactive = !!(job.live as { interactive?: boolean } | null)?.interactive;
  const to = nextControl(job.control as Control | null, action, { interactive });
  if (!to) return json({ error: action === "take" ? "This browser has no live view to control" : "Nothing to continue" }, 409);
  const patch: Record<string, unknown> = { control: to };
  if (to === "user") patch.paused_until = new Date(Date.now() + PAUSE_MS).toISOString();
  if (to === "agent") { patch.paused_until = null; patch.control_reason = null; }
  await db.from("browser_jobs").update(patch).eq("id", params.id).eq("user_id", a.user.id).in("status", ["running", "queued"]);
  return json({ control: to });
}
