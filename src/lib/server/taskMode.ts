import type { Db } from "@/lib/server/auth";
import { APPROVAL_COLS, type Approval } from "@/lib/approvals";
import { executeApproval } from "@/lib/server/approvals";
import { logActivity } from "@/lib/server/activity";
import { taskModeDecision, type AutoDecision } from "@/lib/taskMode";

/** Is task mode on for this chat? */
export async function chatTaskMode(db: Db, userId: string, conversationId: string | null | undefined): Promise<boolean> {
  if (!conversationId) return false;
  const { data } = await db.from("conversations").select("task_mode").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  return !!(data as { task_mode?: boolean } | null)?.task_mode;
}

export async function setChatTaskMode(db: Db, userId: string, conversationId: string, on: boolean): Promise<void> {
  await db.from("conversations").update({ task_mode: on }).eq("id", conversationId).eq("user_id", userId);
}

export type AutoResult =
  | { auto: true; approval: Approval; ok: boolean; result?: Record<string, unknown> | null; error?: string }
  | { auto: false; why: Extract<AutoDecision, { auto: false }>["why"] | "not_pending" };

/**
 * Task mode: approve a pending request in code (auto = true, logged) and run it through the normal execution gate.
 * Payments and deletes are left pending for the user's card.
 */
export async function autoApprove(db: Db, userId: string, approvalId: string): Promise<AutoResult> {
  const { data: row } = await db.from("approval_requests").select(APPROVAL_COLS).eq("id", approvalId).eq("user_id", userId).maybeSingle();
  const a = row as (Approval & { decided_by: string | null }) | null;
  if (!a || a.status !== "pending") return { auto: false, why: "not_pending" };
  const d = taskModeDecision(a);
  if (!d.auto) return { auto: false, why: d.why };
  const { data: ok } = await db.from("approval_requests").update({ status: "approved", auto: true, error: null }).eq("id", approvalId).eq("user_id", userId).eq("status", "pending").select("id");
  if (!ok?.length) return { auto: false, why: "not_pending" };
  await logActivity(db, userId, { category: "approval", title: `Approved automatically (task mode): ${a.summary}`, status: "approved", approval_id: approvalId, task_id: a.task_id, project_id: a.project_id });
  const r = await executeApproval(db, userId, approvalId);
  const final = (r.body.approval ?? a) as Approval;
  return { auto: true, approval: { ...final, auto: true } as Approval, ok: r.status === 200, result: (final.result ?? null) as Record<string, unknown> | null, ...(r.status === 200 ? {} : { error: String(r.body.error ?? "The action failed") }) };
}
