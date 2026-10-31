import { badRequest, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { cooldownLeft } from "@/lib/work";

export const dynamic = "force-dynamic";

/** The user opened an ad link. Enforces the 3-minute gap per link and starts the view. Body: { linkId }. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const linkId = body?.linkId;
  if (typeof linkId !== "string" || !isUuid(linkId)) return badRequest("Invalid link");
  let admin;
  try { admin = createAdminClient(); } catch { return json({ error: "Rewards aren't set up on this server yet" }, 503); }

  const { data: link } = await admin.from("work_links").select("id, url, coins, active").eq("id", linkId).maybeSingle();
  if (!link || !link.active) return json({ error: "This link is no longer available" }, 404);

  const { data: last } = await admin.from("work_views").select("started_at").eq("user_id", a.user.id).eq("link_id", linkId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const wait = cooldownLeft(last?.started_at as string | undefined);
  if (wait > 0) return json({ error: `Please wait ${Math.ceil(wait / 60)} min before opening this link again`, retryAfter: wait }, 429);

  const { data: view, error } = await admin.from("work_views").insert({ user_id: a.user.id, link_id: linkId }).select("id, started_at").single();
  if (error || !view) return json({ error: "Could not start. Try again." }, 500);
  return json({ viewId: view.id, startedAt: view.started_at, url: link.url, coins: link.coins });
}
