import webpush from "web-push";
import type { Db } from "@/lib/server/auth";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let configured: boolean | null = null;

/** True when VAPID keys are set. Without them push is quietly off. */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@gettarget.vercel.app", pub, priv);
    return (configured = true);
  } catch (e) {
    console.error("[push] bad VAPID keys:", e instanceof Error ? e.message : e);
    return (configured = false);
  }
}

/** For tests. */
export function resetPushConfig() { configured = null; }

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends to every device the user turned notifications on for. Dead subscriptions are removed. Returns the count delivered. */
export async function sendPushToUser(db: Db, userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const { data, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId).limit(20);
  if (error || !data?.length) return 0;
  const body = JSON.stringify({ title: payload.title.slice(0, 80), body: payload.body.slice(0, 200), url: payload.url ?? "/app", tag: payload.tag });
  let sent = 0;
  await Promise.all((data as SubRow[]).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 24 });
      sent += 1;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("[push] send failed:", code ?? (e instanceof Error ? e.message : e));
    }
  }));
  return sent;
}
