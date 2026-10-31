import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const str = (v: unknown, min: number, max: number) => (typeof v === "string" && v.length >= min && v.length <= max ? v : null);

/** Save this device's push subscription. Body: the browser's PushSubscription JSON. */
export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const keys = (body?.keys ?? {}) as Record<string, unknown>;
  const endpoint = str(body?.endpoint, 10, 1000);
  const p256dh = str(keys.p256dh, 10, 200);
  const auth = str(keys.auth, 8, 100);
  if (!endpoint || !p256dh || !auth || !endpoint.startsWith("https://")) return badRequest("Invalid subscription");
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  // A device that re-subscribes (or changes account) replaces its old row.
  await a.db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const { error } = await a.db.from("push_subscriptions").insert({ user_id: a.user.id, endpoint, p256dh, auth, user_agent: ua });
  if (error) return dbError(error, "Could not turn on notifications");
  return json({ ok: true });
}

/** Turn notifications off for this device. Body: { endpoint }. */
export async function DELETE(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  const endpoint = str(body?.endpoint, 10, 1000);
  if (!endpoint) return badRequest("Missing endpoint");
  const { error } = await a.db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", a.user.id);
  if (error) return dbError(error, "Could not turn off notifications");
  return json({ ok: true });
}
