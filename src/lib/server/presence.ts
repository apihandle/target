import type { Db } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { countryFrom, deviceFrom, PRESENCE_EVERY_MS } from "@/lib/presence";

const lastWrite = new Map<string, number>();

/** For tests. */
export function resetPresence() { lastWrite.clear(); }

/**
 * Record that a user is active (country code + coarse device, never the IP or full user agent), at most once every
 * 5 minutes per user per server instance. Never throws; a missing table (migration 0019) is ignored.
 */
export async function touchPresence(userId: string, headers: Headers, now = Date.now(), dbIn?: Db): Promise<boolean> {
  const prev = lastWrite.get(userId) ?? 0;
  if (now - prev < PRESENCE_EVERY_MS) return false;
  lastWrite.set(userId, now);
  if (lastWrite.size > 5000) for (const [k, t] of lastWrite) if (now - t > PRESENCE_EVERY_MS) lastWrite.delete(k);
  let db = dbIn;
  try { db = db ?? (createAdminClient() as unknown as Db); } catch { return false; }
  const row: Record<string, unknown> = { user_id: userId, last_seen_at: new Date(now).toISOString() };
  const country = countryFrom(headers.get("x-vercel-ip-country"));
  const device = deviceFrom(headers.get("user-agent"));
  if (country) row.country = country;
  if (device) row.device = device;
  try {
    const { error } = await db.from("user_presence").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch { return false; }
}
