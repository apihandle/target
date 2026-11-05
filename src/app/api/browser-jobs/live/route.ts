import { json, requireUser, unauthorized, type Db } from "@/lib/server/auth";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeLiveUrl, viewMode } from "@/lib/liveView";

export const dynamic = "force-dynamic";

/**
 * The newest browser task in one of the user's chats, for the live panel: step log, current URL, who is in control,
 * the interactive live-view URL while it runs, and the latest screenshot when there is no live view (or it ended).
 */
export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const c = new URL(req.url).searchParams.get("c") ?? "";
  if (!isUuid(c)) return json({ job: null });
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { db = a.db; }
  const since = new Date(Date.now() - 20 * 60000).toISOString();
  const { data } = await db.from("browser_jobs").select("id, goal, start_url, status, log, error, created_at, finished_at, live, frame, frame_url, frame_at, control, control_reason, paused_until")
    .eq("user_id", a.user.id).eq("conversation_id", c).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
  const j = data?.[0] as Record<string, unknown> | undefined;
  if (!j) return json({ job: null }, 200);
  const log = Array.isArray(j.log) ? (j.log as unknown[]).filter((x): x is string => typeof x === "string").slice(-12) : [];
  const liveIn = j.live as { provider?: string; url?: string; interactive?: boolean } | null;
  const url = safeLiveUrl(liveIn?.url);
  const live = url ? { provider: String(liveIn?.provider ?? ""), url, interactive: !!liveIn?.interactive } : null;
  const mode = viewMode({ status: String(j.status), live, frame: j.frame as string | null });
  // A job waiting for approval: its pending card (approval_requests) so the live card can show Approve inline.
  let approval_id: string | null = null;
  if (j.status === "needs_approval") {
    const { data: aps } = await db.from("approval_requests").select("id, payload, status").eq("user_id", a.user.id).eq("conversation_id", c).eq("status", "pending").limit(20);
    approval_id = ((aps ?? []) as { id: string; payload: { browser_job_id?: string } | null }[]).find((x) => x.payload?.browser_job_id === j.id)?.id ?? null;
  }
  const job = {
    id: j.id, approval_id, goal: j.goal, start_url: j.start_url, status: j.status, log, error: j.error, created_at: j.created_at, finished_at: j.finished_at,
    live: j.status === "running" ? live : null, mode,
    // The screenshot only travels when it is what the panel shows.
    frame: mode === "screens" ? j.frame : null, frame_url: j.frame_url ?? null, frame_at: j.frame_at ?? null,
    control: j.control ?? null, control_reason: j.control_reason ?? null, paused_until: j.paused_until ?? null,
  };
  return new Response(JSON.stringify({ job }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
