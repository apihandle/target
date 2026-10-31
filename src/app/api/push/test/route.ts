import { json, requireUser, unauthorized } from "@/lib/server/auth";
import { pushConfigured, sendPushToUser } from "@/lib/server/push";
import { rateLimit } from "@/lib/connectors/rateLimit";

export const dynamic = "force-dynamic";

/** Sends a test notification to the signed-in user's devices. */
export async function POST() {
  const a = await requireUser();
  if (!a) return unauthorized();
  if (!pushConfigured()) return json({ error: "Notifications aren't set up on this server yet" }, 503);
  if (!(await rateLimit({ key: `pushtest:${a.user.id}`, limit: 5, windowSec: 600 }))) return json({ error: "Too many test notifications. Try again in a few minutes." }, 429);
  const sent = await sendPushToUser(a.db, a.user.id, { title: "TARGET", body: "Notifications are on. You'll hear from us when scheduled work is done.", url: "/app/settings/notifications", tag: "test" });
  return json({ sent });
}
