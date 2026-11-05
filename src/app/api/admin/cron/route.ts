import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { GET as runScheduled } from "@/app/api/cron/scheduled/route";
import { GET as runProactive } from "@/app/api/cron/proactive/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Run cron now": runs a cron handler in this request, with the CRON_SECRET bearer header built here on the server
 * (the secret never reaches the browser). Body: { job: "scheduled" | "proactive", confirm: true }.
 */
export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const job = c.body.job === "proactive" ? "proactive" : c.body.job === "scheduled" ? "scheduled" : null;
  if (!job) return json({ error: "job must be scheduled or proactive" }, 400);
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return json({ error: "CRON_SECRET is not set on the server." }, 503);
  const entry = { action: "cron.run", targetType: "cron", targetId: job, detail: {} };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const inner = new Request(`http://internal/api/cron/${job}`, { method: "GET", headers: { Authorization: `Bearer ${secret}`, "x-target-run-by": "admin" } });
  let res: Response;
  try { res = await (job === "scheduled" ? runScheduled : runProactive)(inner); }
  catch (e) {
    await auditFailure(a.db, a, entry, e instanceof Error ? e.message : "cron failed");
    return json({ error: "The cron run failed" }, 502);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) await auditFailure(a.db, a, entry, String(body.error ?? `HTTP ${res.status}`));
  // Only the counts go back to the browser.
  const summary = { ran: body.ran, scanned: body.scanned, new: body.new, disabled: body.disabled, error: body.error };
  return json({ ok: res.ok, job, status: res.status, summary }, res.ok ? 200 : 502);
}
