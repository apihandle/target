import { json, type Db } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { kickCloudWorker } from "@/lib/server/kickWorker";
import { isUuid } from "@/lib/ids";
import { retryable } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

const RETRY_COLS = "user_id, goal, start_url, steps, mode, allowed_secrets, max_steps, language, code, inputs, conversation_id, status";

/**
 * Admin control of one browser job. Body: { action: "stop" | "retry", confirm: true }.
 *   stop  -> a queued job is cancelled; a running / paused one is told to stop (the worker ends it, "Stopped")
 *   retry -> a failed / cancelled job is queued again as a new job with the same goal and inputs. Never a job that
 *            pays, books, sends, posts or deletes (checkout / booking inputs, or such a goal): those go back through the
 *            user's own approval, not an admin button.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const { id } = await props.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const action = c.body.action;
  if (action !== "stop" && action !== "retry") return json({ error: "action must be stop or retry" }, 400);
  const db: Db = a.db;
  const { data: job } = await db.from("browser_jobs").select(`id, ${RETRY_COLS}, control`).eq("id", id).maybeSingle();
  if (!job) return json({ error: "Job not found" }, 404);
  const status = String(job.status);
  const entry = { action: `job.${action}`, targetType: "browser_job", targetId: id, detail: { status } };

  if (action === "stop") {
    if (!["queued", "running", "needs_approval"].includes(status)) return json({ error: "This job has already finished" }, 409);
    const blocked = await auditFirst(a, entry);
    if (blocked) return blocked;
    const handingOver = status === "queued" && (job.control === "paused" || job.control === "user");
    const { data, error } = status === "running" || handingOver
      ? await db.from("browser_jobs").update({ control: "stop" }).eq("id", id).in("status", ["running", "queued"]).select("id")
      : await db.from("browser_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "needs_approval"]).select("id");
    if (error || !data?.length) { await auditFailure(db, a, entry, error?.message ?? "job changed"); return json({ error: "The job changed; reload and try again" }, 409); }
    return json({ ok: true, stopped: status === "running" || handingOver ? "stopping" : "cancelled" });
  }

  const why = retryable(job as { status: string; goal?: unknown; inputs?: unknown });
  if (why) return json({ error: why }, 409);
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  const row: Record<string, unknown> = {};
  for (const k of RETRY_COLS.split(", ")) if (k !== "status") row[k] = (job as Record<string, unknown>)[k];
  const { data: created, error } = await db.from("browser_jobs").insert({ ...row, status: "queued" }).select("id").single();
  if (error || !created) { await auditFailure(db, a, entry, error?.message ?? "insert failed"); return json({ error: "Could not queue the retry" }, 502); }
  await kickCloudWorker();
  return json({ ok: true, job_id: created.id });
}
