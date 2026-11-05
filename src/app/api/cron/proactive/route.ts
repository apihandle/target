import { json, type Db } from "@/lib/server/auth";
import { cronAuth } from "@/lib/server/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanUser } from "@/lib/server/proactive";
import { sendPushToUser } from "@/lib/server/push";
import { recordCronRun } from "@/lib/server/adminSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 6;

/**
 * Daily "For you" scan: for users with Google connected (and the switch on), read recent mail and the
 * next 3 days of calendar, and save up to 4 offers to Home. Oldest-scanned users go first, so repeated
 * calls (GitHub Actions) work through everyone.
 */
async function handle(req: Request) {
  const auth = cronAuth(req);
  if (auth === "unconfigured") return json({ error: "Cron is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }

  const { data: conns } = await db.from("connections").select("user_id, status").eq("connector_id", "google");
  const ids = Array.from(new Set((conns ?? []).filter((c) => (c.status ?? "connected") === "connected").map((c) => c.user_id as string)));
  const by = req.headers.get("x-target-run-by") === "admin" ? "admin" : "cron";
  if (!ids.length) { await recordCronRun(db, "proactive", { scanned: 0, by }); return json({ scanned: 0 }); }
  const { data: settings } = await db.from("user_settings").select("user_id, proactive_enabled, proactive_scanned_at").in("user_id", ids);
  const byUser = new Map((settings ?? []).map((s) => [s.user_id as string, s]));
  const cutoff = Date.now() - 20 * 3600000;
  const due = ids
    .filter((id) => byUser.get(id)?.proactive_enabled !== false)
    .map((id) => ({ id, at: byUser.get(id)?.proactive_scanned_at ? Date.parse(byUser.get(id)!.proactive_scanned_at as string) : 0 }))
    .filter((u) => u.at < cutoff).sort((a, b) => a.at - b.at).slice(0, BATCH);

  const results = await Promise.all(due.map(async (u) => {
    await db.from("user_settings").upsert({ user_id: u.id, proactive_scanned_at: new Date().toISOString() }, { onConflict: "user_id" });
    try {
      const n = await scanUser(db, u.id);
      if (n) await sendPushToUser(db, u.id, { title: "TARGET found something for you", body: `${n} new ${n === 1 ? "thing" : "things"} on your Home`, url: "/app/home", tag: "proactive" }).catch(() => undefined);
      return { new: n };
    } catch { return { new: 0, error: true }; }
  }));
  await recordCronRun(db, "proactive", { scanned: results.length, by });
  return json({ scanned: results.length, new: results.reduce((s, r) => s + r.new, 0) });
}

export const GET = handle;
export const POST = handle;
