import { json, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The newest browser task in one of the user's chats, with its live step log, for the progress card. */
export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const c = new URL(req.url).searchParams.get("c") ?? "";
  if (!isUuid(c)) return json({ job: null });
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { db = a.db; }
  const since = new Date(Date.now() - 20 * 60000).toISOString();
  const { data } = await db.from("browser_jobs").select("id, goal, start_url, status, log, error, created_at, finished_at")
    .eq("user_id", a.user.id).eq("conversation_id", c).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  const j = data?.[0] as { log?: unknown } | undefined;
  if (!j) return json({ job: null }, 200);
  const log = Array.isArray(j.log) ? (j.log as unknown[]).filter((x): x is string => typeof x === "string").slice(-12) : [];
  return new Response(JSON.stringify({ job: { ...j, log } }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
