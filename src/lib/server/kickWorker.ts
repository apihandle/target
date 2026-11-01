import { SITE } from "@/lib/builtins/helpers";

/** Ask the built-in cloud worker to start now. Fire-and-forget: waits at most ~1.5s for the request to go out. */
export async function kickCloudWorker(env: Record<string, string | undefined> = process.env): Promise<void> {
  const secret = env.CRON_SECRET;
  if (!secret || !(env.STEEL_API_KEY || env.BROWSERLESS_TOKEN || env.BROWSERBASE_API_KEY || env.HYPERBROWSER_API_KEY || env.ANCHOR_API_KEY)) return;
  const p = fetch(`${SITE}/api/browser-jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } }).catch(() => undefined);
  await Promise.race([p, new Promise((r) => setTimeout(r, 1500))]);
}
