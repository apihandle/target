import { badRequest, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { WORK_CLAIM_WINDOW_SEC, WORK_MIN_STAY_SEC } from "@/lib/work";

export const dynamic = "force-dynamic";

/** The user came back from the ad. Credits the link's coins once, if they stayed long enough. Body: { viewId }. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const viewId = body?.viewId;
  if (typeof viewId !== "string" || !isUuid(viewId)) return badRequest("Invalid view");
  let admin;
  try { admin = createAdminClient(); } catch { return json({ error: "Rewards aren't set up on this server yet" }, 503); }

  const { data: view } = await admin.from("work_views").select("id, user_id, link_id, started_at, claimed_at").eq("id", viewId).maybeSingle();
  if (!view || view.user_id !== a.user.id) return json({ error: "Not found" }, 404);
  if (view.claimed_at) return json({ error: "Already rewarded" }, 409);
  const age = (Date.now() - Date.parse(view.started_at as string)) / 1000;
  if (age < WORK_MIN_STAY_SEC) return json({ error: `Stay on the ad at least ${WORK_MIN_STAY_SEC} seconds`, waitMore: Math.ceil(WORK_MIN_STAY_SEC - age) }, 425);
  if (age > WORK_CLAIM_WINDOW_SEC) return json({ error: "This view expired" }, 410);

  const { data: link } = await admin.from("work_links").select("coins").eq("id", view.link_id).maybeSingle();
  const coins = Number(link?.coins ?? 1);
  // claimed_at is null in the filter, so two claims racing for the same view can only credit once.
  const { data: done, error } = await admin.from("work_views").update({ claimed_at: new Date().toISOString(), coins }).eq("id", viewId).is("claimed_at", null).select("id");
  if (error) return json({ error: "Could not add coins. Try again." }, 500);
  if (!done?.length) return json({ error: "Already rewarded" }, 409);
  const { data: bal } = await admin.rpc("work_balance", { p_user: a.user.id });
  return json({ coins, balance: Number(bal ?? 0) });
}
