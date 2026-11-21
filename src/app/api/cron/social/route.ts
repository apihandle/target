import { json, type Db } from "@/lib/server/auth";
import { cronAuth } from "@/lib/server/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureOn, recordCronRun } from "@/lib/server/adminSettings";
import { runDueScheduledPosts } from "@/lib/server/socialSchedule";
import { runBloggerAutopilot } from "@/lib/server/socialAutopilot";
import { reportError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Posts published per invocation (each publish polls Instagram briefly, so keep the batch small). */
const BATCH = 3;

/**
 * Cron entry point for scheduled social posts (migration 0024): publishes due rows from
 * social_scheduled_posts to TARGET's Facebook Page / Instagram. Same protection as the other cron
 * routes: CRON_SECRET bearer (closed when unconfigured), the admin kill-switch, and an atomic
 * per-post claim inside the runner, so overlapping invocations can never post the same item twice.
 * Before the drain, the Blogger autopilot step (migration 0026) queues one fresh post per opted-in
 * user, due immediately — the drain below then publishes it in this same run. The 4-hourly
 * autopilot cadence is triggered from the website's own backend (Supabase pg_cron calling this
 * endpoint with the CRON_SECRET bearer); the vercel.json cron fires it only daily, because
 * Vercel's Hobby plan allows no more than that — it is a safety net, not the cadence.
 */
async function handle(req: Request) {
  const auth = cronAuth(req);
  if (auth === "unconfigured") return json({ error: "Cron is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  // The admin "Run cron now" button calls this handler on the server with the same bearer header and this marker
  // (only read after the secret check, so it can't be spoofed from outside).
  const by = req.headers.get("x-target-run-by") === "admin" ? "admin" : "cron";

  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, 503); }
  // Admin kill-switch: social posting paused site-wide. The heartbeat still records that cron is alive.
  if (!(await featureOn("social_posting", db))) { await recordCronRun(db, "social", { ran: 0, by, disabled: true }); return json({ ran: 0, disabled: true }); }

  try {
    // Autopilot first, drain second — and the generation step can never take the drain down with it.
    // Autopilot failures (e.g. the writer provider rejecting a user's saved key) ride along in the
    // response and the run record, the same way per-post results do — never silently swallowed.
    const autopilot = await runBloggerAutopilot(db).catch(() => ({ generated: 0, failures: [] as { userId: string; error: string }[] }));
    const { ran, results } = await runDueScheduledPosts(db, { batch: BATCH });
    await recordCronRun(db, "social", { ran, by, autopilot: autopilot.generated, autopilotFailures: autopilot.failures });
    return json({ ran, results, autopilot });
  } catch (e) {
    await reportError({ source: "cron", message: `Social cron failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}` }, db);
    return json({ error: "Social cron failed" }, 500);
  }
}

export const GET = handle;
export const POST = handle;
