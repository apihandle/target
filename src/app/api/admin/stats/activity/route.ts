import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { isRange, loadActivitySeries } from "@/lib/server/adminStats";

export const dynamic = "force-dynamic";

/** Messages sent by users and distinct active users per time bucket. ?range=3h|24h|7d|30d (default 24h). */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const r = new URL(req.url).searchParams.get("range");
  const s = await loadActivitySeries(a.db, isRange(r) ? r : "24h");
  return json(s, s.error ? 502 : 200);
}
