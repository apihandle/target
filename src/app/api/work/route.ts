import { json } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cooldownLeft, type WorkLink } from "@/lib/work";

export const dynamic = "force-dynamic";

/** Links for the Work page, plus (when signed in) the coin balance and each link's cooldown. */
export async function GET() {
  const supabase = createClient();
  const { data: links, error } = await supabase.from("work_links").select("id, title, url, coins").eq("active", true).order("sort", { ascending: true }).order("created_at", { ascending: true }).limit(100);
  if (error) return json({ links: [], signedIn: false, error: "Work links aren't set up yet" }, 200);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ links: links as WorkLink[], signedIn: false });

  let balance = 0;
  const cooldowns: Record<string, number> = {};
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const [{ data: bal }, { data: recent }] = await Promise.all([
      admin.rpc("work_balance", { p_user: user.id }),
      admin.from("work_views").select("link_id, started_at").eq("user_id", user.id).gte("started_at", since).order("started_at", { ascending: false }).limit(200),
    ]);
    balance = Number(bal ?? 0);
    for (const r of (recent ?? []) as { link_id: string; started_at: string }[]) {
      if (cooldowns[r.link_id] === undefined) cooldowns[r.link_id] = cooldownLeft(r.started_at);
    }
  } catch { /* service key missing: links still show */ }
  return json({ links: links as WorkLink[], signedIn: true, balance, cooldowns });
}
