import { badRequest, json, notFound, readJson, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/server/activity";
import { kickCloudWorker } from "@/lib/server/kickWorker";

export const dynamic = "force-dynamic";

/** The owner approves (queues) or cancels a browser task. Only these two moves exist. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!isUuid(params.id)) return notFound();
  const b = await readJson(req);
  const action = b?.action;
  if (action !== "approve" && action !== "cancel") return badRequest("action must be approve or cancel");
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  const from = action === "approve" ? ["needs_approval"] : ["needs_approval", "queued"];
  const { data } = await db.from("browser_jobs").update({ status: action === "approve" ? "queued" : "cancelled", ...(action === "cancel" ? { finished_at: new Date().toISOString() } : {}) })
    .eq("id", params.id).eq("user_id", a.user.id).in("status", from).select("id, goal, status");
  if (!data?.length) return json({ error: "This task can't be changed now" }, 409);
  await logActivity(a.db, a.user.id, { category: "approval", title: `${action === "approve" ? "Approved" : "Cancelled"} browser task “${String(data[0].goal).slice(0, 80)}”` });
  if (action === "approve") await kickCloudWorker();
  return json({ job: data[0] });
}
