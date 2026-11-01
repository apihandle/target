import { json } from "@/lib/server/auth";
import { cronAuth } from "@/lib/server/cron";
import { runQueuedJobs } from "@/lib/server/cloudWorker";
import { configuredProviders } from "@/lib/server/remoteBrowser";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Built-in cloud worker. Called with "Authorization: Bearer <CRON_SECRET>" by the GitHub Actions tick
 * (every 10 min) and right after a browser job is queued. Runs queued steps/auto jobs on a cloud browser.
 */
async function handle(req: Request) {
  const auth = cronAuth(req);
  if (auth === "unconfigured") return json({ error: "CRON_SECRET is not set" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  const secret = process.env.SESSION_WORKER_SECRET;
  if (!secret || secret.length < 32) return json({ error: "SESSION_WORKER_SECRET is not set" }, 503);
  const providers = configuredProviders();
  if (!providers.length) return json({ providers, ran: 0, results: [] });
  const results = await runQueuedJobs({ budgetMs: 270000, secret });
  return json({ providers, ran: results.length, results });
}

export const GET = handle;
export const POST = handle;
