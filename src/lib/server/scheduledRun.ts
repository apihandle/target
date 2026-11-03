import type { Db } from "@/lib/server/auth";
import { SYSTEM_PROMPT, titleFrom } from "@/lib/ai";
import { llm, LLMError, type LLMMessage } from "@/lib/llm";
import { runAgent, type ToolCall } from "@/lib/agent";
import { executeToolCall, loadToolsForUser, toOpenAITools, toolsPrompt, type LoadedTool } from "@/lib/connectors/loadTools";
import { UNTRUSTED_RULES } from "@/lib/connectors/safety";
import { getConnector } from "@/lib/connectors/registry";
import { loadPreferredModel, loadSettings } from "@/lib/settings";
import { resolveUserPick } from "@/lib/server/customProviders";
import { MAX_MEMORIES, memoryBlock } from "@/lib/memory";
import { projectBlock } from "@/lib/projects";
import { logActivity } from "@/lib/server/activity";
import { nextRunAt, nowLineFor, type ScheduledJob } from "@/lib/schedule";

/**
 * Runs one scheduled prompt for its owner through the same agent loop and connector tools as chat.
 * Called only by the cron route with the service-role client, so every query here filters by the
 * job's user_id explicitly. Tools that need approval become pending approval requests (the task
 * pauses in waiting_approval); nothing is ever auto-approved.
 */
export type RunOutcome = { status: "completed" | "waiting_approval" | "needs_connection" | "failed"; taskId: string | null; conversationId: string | null; error?: string };

export async function runScheduledJob(db: Db, job: ScheduledJob & { user_id: string }, opts: { deadline: number }): Promise<RunOutcome> {
  const uid = job.user_id;
  const now = () => new Date().toISOString();
  let projectId = job.project_id;
  let project: { name: string; instructions: string; description?: string } | null = null;
  if (projectId) {
    const { data: p } = await db.from("projects").select("name, instructions, description").eq("id", projectId).eq("user_id", uid).maybeSingle();
    project = (p as typeof project) ?? null;
    if (!project) projectId = null;
  }

  const { data: conv, error: cErr } = await db.from("conversations").insert({ user_id: uid, title: titleFrom(`Scheduled: ${job.title}`), project_id: projectId }).select("id").single();
  if (cErr || !conv) return { status: "failed", taskId: null, conversationId: null, error: "Could not create the chat for this run" };
  const convId = conv.id as string;
  await db.from("messages").insert({ conversation_id: convId, user_id: uid, role: "user", content: job.prompt });

  const { data: t } = await db.from("tasks").insert({
    user_id: uid, title: `Scheduled: ${job.title}`.slice(0, 200), status: "planning", origin: "assistant",
    project_id: projectId, conversation_id: convId, progress: "Running your scheduled prompt…",
  }).select("id").single();
  const taskId = (t?.id as string) ?? null;
  await logActivity(db, uid, { category: "task", title: `Scheduled run started: “${job.title}”`, status: "planning", task_id: taskId, project_id: projectId });

  const finish = async (status: RunOutcome["status"], content: string, progress: string, error?: string): Promise<RunOutcome> => {
    if (content) await db.from("messages").insert({ conversation_id: convId, user_id: uid, role: "assistant", content });
    await db.from("conversations").update({ updated_at: now() }).eq("id", convId).eq("user_id", uid);
    if (taskId && (status === "completed" || status === "failed"))
      await db.from("tasks").update({ status, progress, error: error ? error.slice(0, 400) : null, updated_at: now() }).eq("id", taskId).eq("user_id", uid);
    await logActivity(db, uid, {
      category: status === "completed" || status === "failed" ? "outcome" : "task",
      title: status === "completed" ? `Scheduled run finished: “${job.title}”` : status === "failed" ? `Scheduled run failed: “${job.title}”` : `Scheduled run paused: “${job.title}”`,
      detail: error ?? progress, status, task_id: taskId, project_id: projectId,
    });
    return { status, taskId, conversationId: convId, error };
  };

  try {
    const settings = await loadSettings(db, uid);
    let known: string[] = [];
    if (settings.memory_enabled) {
      const { data: mem } = await db.from("memories").select("content").eq("user_id", uid).order("created_at", { ascending: true }).limit(MAX_MEMORIES);
      known = ((mem ?? []) as { content: string }[]).map((m) => m.content);
    }
    let loaded: { tools: LoadedTool[]; connected: Set<string> } = { tools: [], connected: new Set() };
    try { loaded = await loadToolsForUser(uid, db); } catch { /* connectors unavailable */ }
    const toolSpecs = toOpenAITools(loaded.tools, loaded.connected);
    const connectorNote = toolSpecs.length ? toolsPrompt(loaded.tools, loaded.connected) + UNTRUSTED_RULES : "";
    const pick = await resolveUserPick(uid, await loadPreferredModel(db, uid));
    const prefer = pick.builtin;
    const custom = pick.custom; // the user's own provider, when picked: used alone (no fallback)
    const note = `\n\nSCHEDULED RUN: The user set up this prompt to run automatically (“${job.title}”). They are not watching live, so do the work and write the result directly; ` +
      "don't ask follow-up questions. Anything that needs their approval will wait for them.";
    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT + nowLineFor(job.timezone) + note + projectBlock(project) + memoryBlock(known) + connectorNote },
      { role: "user", content: job.prompt },
    ];
    let first: Response;
    let tools = toolSpecs.length ? toolSpecs : undefined;
    try {
      first = await llm({ messages, stream: true, timeoutMs: 25000, tools, prefer, custom });
    } catch (e) {
      if (!(e instanceof LLMError) || !e.toolsRejected) throw e;
      tools = undefined;
      first = await llm({ messages: messages.map((m) => (m.role === "system" ? { ...m, content: String(m.content).replace(connectorNote, "") } : m)), stream: true, timeoutMs: 25000, prefer, custom });
    }
    if (taskId) await db.from("tasks").update({ status: "in_progress", progress: "TARGET is working on it…", updated_at: now() }).eq("id", taskId).eq("user_id", uid);

    let full = "";
    const result = await runAgent({
      messages, first, maxRounds: 3,
      next: (msgs) => llm({ messages: msgs, stream: true, timeoutMs: 25000, tools, prefer, custom }),
      onText: (d) => { full += d; },
      label: (call: ToolCall) => call.function.name.replace("__", " · ").replace(/_/g, " "),
      onTool: (call: ToolCall) => executeToolCall({ db, userId: uid, projectId, conversationId: convId, taskId, autoApproveBrowser: job.allow_browser === true }, call.function.name, call.function.arguments, loaded),
      cancelled: () => Date.now() > opts.deadline,
    });

    if (result.pause?.kind === "approval") {
      // executeToolCall already recorded the pending approval and moved the task to waiting_approval.
      full += `\n\nI've prepared this for your approval: **${result.pause.summary.replace(/[*_`]/g, "")}**. Nothing happens until you approve it.\n\n\`\`\`actions\n${JSON.stringify([{ type: "approval", id: result.pause.approvalId }])}\n\`\`\``;
      return await finish("waiting_approval", full, "Waiting for your approval.");
    }
    if (result.pause?.kind === "needs_connection") {
      const name = getConnector(result.pause.connector)?.name ?? result.pause.connector;
      if (taskId) await db.from("tasks").update({ status: "needs_connection", needs_connector: result.pause.connector, progress: `Waiting for you to connect ${name}.`, updated_at: now() }).eq("id", taskId).eq("user_id", uid);
      full += `\n\nTo finish this scheduled run I need access to your ${name} account. Connect it below and I'll pick up where I left off.\n\n\`\`\`actions\n${JSON.stringify([{ type: "connect", connector: result.pause.connector, ...(taskId ? { taskId } : {}) }])}\n\`\`\``;
      return await finish("needs_connection", full, `Waiting for you to connect ${name}.`);
    }
    if (result.interrupted || !full.trim()) return await finish("failed", full, "TARGET couldn't finish this run.", result.interrupted ? "The AI connection was interrupted." : "The AI returned an empty reply.");
    if (Date.now() > opts.deadline) full += "\n\n_[Stopped: this scheduled run hit its time limit]_";
    if (result.hitLimit) full += "\n\n_I stopped after several tool steps. Open this chat and tell me to continue if you want more._";
    return await finish("completed", full, "Scheduled run finished. Open the chat to read the result.");
  } catch (e) {
    const msg = e instanceof LLMError ? e.message : "The scheduled run failed";
    if (!(e instanceof LLMError)) console.error("[scheduled] run failed:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return await finish("failed", "", "TARGET couldn't finish this run.", msg);
  }
}

/** Claim one due job atomically (moves next_run_at forward only if nobody else did). Returns false if already claimed. */
export async function claimJob(db: Db, job: Pick<ScheduledJob, "id" | "next_run_at" | "cadence" | "weekday" | "time_of_day" | "timezone" | "run_on" | "interval_hours">, now: Date): Promise<boolean> {
  // A one-time reminder finishes after this run (status "done"); repeating jobs move to their next slot.
  const next = job.cadence === "once" ? null : nextRunAt(job, now);
  const { data, error } = await db.from("scheduled_jobs")
    .update({ next_run_at: next ? next.toISOString() : null, ...(next ? {} : { status: "done" }), last_run_at: now.toISOString(), last_status: "running", updated_at: now.toISOString() })
    .eq("id", job.id).eq("status", "active").eq("next_run_at", job.next_run_at as string).select("id");
  return !error && !!data?.length;
}
