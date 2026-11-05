import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { envStatus, healthSummary, runHealthChecks } from "@/lib/server/adminHealth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Live health checks + env vars as set/missing (never values). ?summary=1: just OK/degraded for the top bar (cached 60 s). */
export async function GET(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  if (new URL(req.url).searchParams.get("summary") === "1") return json(await healthSummary(a.db));
  const { checks, checkedAt } = await runHealthChecks(a.db);
  return json({ checks, checkedAt, env: envStatus() });
}
