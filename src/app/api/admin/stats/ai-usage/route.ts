import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { isAiRange, loadAiStats } from "@/lib/server/adminAiUsage";

export const dynamic = "force-dynamic";

/** AI usage summary for a range: ?range=24h|7d|30d (default 24h). Counters only, never prompt or reply text. */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const r = new URL(req.url).searchParams.get("range");
  const s = await loadAiStats(a.db, isAiRange(r) ? r : "24h");
  return json(s, s.error ? 502 : 200);
}
