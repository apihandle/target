import { kickCloudWorker } from "@/lib/server/kickWorker";
import type { Db } from "@/lib/server/auth";
import { ACTION_DEFS, APPROVAL_COLS, availability, type Approval, type Params, type Proposal } from "@/lib/approvals";
import { getConnector, isConfigured } from "@/lib/connectors/registry";
import { logActivity } from "@/lib/server/activity";

export type ExecCtx = { db: Db; userId: string; projectId: string | null };
export type Executor = (params: Params, ctx: ExecCtx) => Promise<Record<string, unknown>>;

/** The ONLY place approved actions are carried out. Nothing in the chat/AI path imports these. */
export const EXECUTORS: Record<string, Executor> = {
  async create_task(p, { db, userId, projectId }) {
    const { data, error } = await db.from("tasks").insert({ user_id: userId, title: p.title, notes: p.notes ?? "", project_id: projectId, origin: "assistant" }).select("id").single();
    if (error || !data) throw new Error("Couldn't save the task");
    return { task_id: data.id };
  },
  async create_project(p, { db, userId }) {
    const { data, error } = await db.from("projects").insert({ user_id: userId, name: p.name, description: p.description ?? "" }).select("id").single();
    if (error || !data) throw new Error("Couldn't create the project");
    return { project_id: data.id };
  },
  async create_schedule(p, { db, userId, projectId }) {
    const { MAX_JOBS_PER_USER, nextRunAt, JOB_COLS } = await import("@/lib/schedule");
    const { count } = await db.from("scheduled_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= MAX_JOBS_PER_USER) throw new Error(`You can keep up to ${MAX_JOBS_PER_USER} scheduled prompts. Delete one first.`);
    const job = { title: p.title, prompt: p.prompt, cadence: p.cadence as "daily" | "weekly" | "once" | "interval", weekday: p.weekday === "" ? null : Number(p.weekday), run_on: p.run_on || null, interval_hours: p.interval_hours ? Number(p.interval_hours) : null, time_of_day: p.time_of_day, timezone: p.timezone, project_id: projectId };
    const first = nextRunAt(job);
    if (!first) throw new Error("That reminder time has already passed. Ask again with a new time.");
    const { data, error } = await db.from("scheduled_jobs").insert({ user_id: userId, ...job, status: "active", next_run_at: first.toISOString() }).select(JOB_COLS).single();
    if (error || !data) throw new Error("Couldn't save the scheduled prompt");
    return { job_id: (data as { id: string }).id };
  },
  async calendar_event(p, { userId }) {
    const { getCredentials } = await import("@/lib/connectors/store");
    const { createEvent, google } = await import("@/lib/connectors/google");
    const { creds } = await getCredentials(userId, google);
    return await createEvent(creds.access_token, { title: p.title, start: p.start, end: p.end, location: p.location, details: p.details });
  },
  /** An order prepared by the checkout tool: the user's tap queues its browser job (needs_approval -> queued). */
  async purchase(p, { db, userId }) {
    const { data } = await db.from("browser_jobs").update({ status: "queued" }).eq("id", p.browser_job_id).eq("user_id", userId).in("status", ["needs_approval", "failed"]).select("id");
    if (!data?.length) throw new Error("This order can't be started again.");
    await kickCloudWorker();
    return { browser_job_id: p.browser_job_id, note: "The browser is placing the order now. You'll get a notification when it's done." };
  },
  /** A connector tool marked requiresApproval, proposed by the agent loop. Payload is immutable after creation. */
  async connector_tool(p, { userId }) {
    const { runApprovedTool } = await import("@/lib/connectors/loadTools");
    return await runApprovedTool(userId, p as unknown as { connector: string; tool: string; args: unknown });
  },
};

export async function connectedProviders(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db.from("connections").select("connector_id, status").eq("user_id", userId);
  return new Set((data ?? []).filter((r) => (r.status ?? "connected") === "connected").map((r) => r.connector_id as string));
}

export const providerConfigured = (env: Record<string, string | undefined> = process.env) => (id: string) => {
  const c = getConnector(id);
  return !!c && isConfigured(c, env);
};

/**
 * Record an assistant proposal as a PENDING approval request. Proposing never executes anything.
 * Returns null when the action can't be performed (caller shows the limitation instead).
 */
export async function proposeAction(db: Db, userId: string, p: Proposal, ctx: { projectId: string | null; conversationId: string | null; connected: Set<string> }):
  Promise<{ ok: true; approval: Pick<Approval, "id" | "summary" | "destination" | "action_type" | "status"> } | { ok: false; reason: string }> {
  const av = availability(p.action, { connected: ctx.connected, configured: providerConfigured() });
  if (!av.available) return { ok: false, reason: av.reason };
  const external = !!ACTION_DEFS[p.action]?.provider;
  let taskId: string | null = null;
  if (external) {
    const { data: t } = await db.from("tasks").insert({
      user_id: userId, title: p.summary.slice(0, 200), status: "waiting_approval", origin: "assistant",
      project_id: ctx.projectId, conversation_id: ctx.conversationId, progress: "Prepared by TARGET. Waiting for your approval.",
    }).select("id").single();
    taskId = (t?.id as string) ?? null;
  }
  const { data, error } = await db.from("approval_requests").insert({
    user_id: userId, action_type: p.action, summary: p.summary, destination: p.destination, payload: p.params,
    status: "pending", project_id: ctx.projectId, conversation_id: ctx.conversationId, task_id: taskId,
  }).select("id, summary, destination, action_type, status").single();
  if (error || !data) return { ok: false, reason: "Couldn't prepare that action for approval." };
  await logActivity(db, userId, { category: "approval", title: `Approval requested: ${p.summary}`, detail: `Destination: ${p.destination}`, status: "pending", approval_id: data.id as string, task_id: taskId, project_id: ctx.projectId });
  return { ok: true, approval: data as Pick<Approval, "id" | "summary" | "destination" | "action_type" | "status"> };
}

type Result = { status: number; body: Record<string, unknown> };

async function loadOwned(db: Db, userId: string, id: string): Promise<(Approval & { decided_by: string | null; user_id?: string }) | null> {
  const { data } = await db.from("approval_requests").select(APPROVAL_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
  return (data as (Approval & { decided_by: string | null })) ?? null;
}

async function setTask(db: Db, userId: string, taskId: string | null, patch: Record<string, unknown>) {
  if (!taskId) return;
  await db.from("tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", userId);
}

/** User decision. Approve → runs the action through executeApproval; reject → nothing runs. */
export async function decideApproval(db: Db, userId: string, id: string, decision: "approve" | "reject", executors = EXECUTORS): Promise<Result> {
  const row = await loadOwned(db, userId, id);
  if (!row) return { status: 404, body: { error: "Not found" } };
  if (row.status !== "pending" && row.status !== "failed") return { status: 409, body: { error: `Already ${row.status}`, approval: row } };

  if (decision === "reject") {
    const to = row.status === "pending" ? "rejected" : "cancelled";
    const { data } = await db.from("approval_requests").update({ status: to }).eq("id", id).eq("user_id", userId).eq("status", row.status).select(APPROVAL_COLS);
    if (!data?.length) return { status: 409, body: { error: "This request changed. Reload and try again." } };
    await setTask(db, userId, row.task_id, { status: "cancelled", progress: "You rejected this action. Nothing was done." });
    await logActivity(db, userId, { category: "approval", title: `Rejected: ${row.summary}`, detail: "Nothing was done.", status: to, approval_id: id, task_id: row.task_id, project_id: row.project_id });
    return { status: 200, body: { approval: data[0] } };
  }

  const { data } = await db.from("approval_requests").update({ status: "approved", error: null }).eq("id", id).eq("user_id", userId).eq("status", row.status).select(APPROVAL_COLS);
  if (!data?.length) return { status: 409, body: { error: "This request changed. Reload and try again." } };
  await logActivity(db, userId, { category: "approval", title: `Approved: ${row.summary}`, status: "approved", approval_id: id, task_id: row.task_id, project_id: row.project_id });
  return executeApproval(db, userId, id, executors);
}

/**
 * Execution gate. Refuses unless the request belongs to this user, is in status "approved",
 * and was approved by this same user. Claims the row atomically (approved → executing) so it
 * can't run twice.
 */
export async function executeApproval(db: Db, userId: string, id: string, executors = EXECUTORS): Promise<Result> {
  const row = await loadOwned(db, userId, id);
  if (!row) return { status: 404, body: { error: "Not found" } };
  if (row.status !== "approved") return { status: 409, body: { error: "This action hasn't been approved." } };
  if (row.decided_by && row.decided_by !== userId) return { status: 403, body: { error: "Approved by someone else." } };
  if (!row.decided_by) return { status: 409, body: { error: "This action hasn't been approved." } };
  const exec = executors[row.action_type];
  const av = availability(row.action_type, { connected: await connectedProviders(db, userId), configured: providerConfigured() });
  const { data: claimed } = await db.from("approval_requests").update({ status: "executing" }).eq("id", id).eq("user_id", userId).eq("status", "approved").select("id");
  if (!claimed?.length) return { status: 409, body: { error: "Already running." } };
  await setTask(db, userId, row.task_id, { status: "in_progress", progress: "Approved. Running now…", error: null });

  let result: Record<string, unknown> | null = null, failure: string | null = null;
  if (!exec || !av.available) failure = av.available ? "This action can't be performed." : av.reason;
  else {
    try { result = await exec(row.payload as Params, { db, userId, projectId: row.project_id }); }
    catch (e) { failure = e instanceof Error ? e.message.slice(0, 400) : "Action failed"; }
  }

  const now = new Date().toISOString();
  const patch = failure ? { status: "failed", error: failure } : { status: "executed", result, executed_at: now };
  const { data: final } = await db.from("approval_requests").update(patch).eq("id", id).eq("user_id", userId).select(APPROVAL_COLS);
  await setTask(db, userId, row.task_id, failure ? { status: "failed", error: failure, progress: "The approved action failed." } : { status: "completed", progress: "Done.", error: null });
  await logActivity(db, userId, {
    category: "outcome", title: failure ? `Failed: ${row.summary}` : `Done: ${row.summary}`,
    detail: failure ?? `Completed in ${row.destination}.`, status: failure ? "failed" : "executed",
    approval_id: id, task_id: row.task_id, project_id: row.project_id,
  });
  return { status: failure ? 502 : 200, body: { approval: final?.[0] ?? { ...row, ...patch }, ...(failure ? { error: failure } : {}) } };
}
