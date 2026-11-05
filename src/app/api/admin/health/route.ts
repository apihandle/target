import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { envStatus, runHealthChecks } from "@/lib/server/adminHealth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Live health checks + env vars as set/missing (never values). */
export async function GET() {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { checks, checkedAt } = await runHealthChecks(a.db);
  return json({ checks, checkedAt, env: envStatus() });
}
