import { createClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT, titleFrom, type ChatMsg } from "@/lib/ai";
import { BLOCKS_PROMPT } from "@/lib/blocks";
import { CAPABILITIES, MULTI_PLAYBOOK, detectTask, isMultiTask, MAX_TOKENS, PLAYBOOKS, taskModel } from "@/lib/skills";
import { llm, llmText, LLMError } from "@/lib/llm";
import { ACTIONS_PROMPT, heuristicActions, mergeActions, sanitizeAction, type Action } from "@/lib/actions";
import { projectBlock } from "@/lib/projects";
import { extractUrls, pagesBlock, readUrl } from "@/lib/urlReader";
import { BUILTIN_ID, getBuiltin } from "@/lib/builtins/tools";
import { needsSearch, searchBlock, searchQuery, sourcesFence, tavilySearch, type SearchResult } from "@/lib/search";
import { EXTRACT_PROMPT, MAX_MEMORIES, explicitRemember, isDuplicate, looksSecret, memoryBlock, parseFacts } from "@/lib/memory";
import { isUuid } from "@/lib/ids";
import { loadSettings } from "@/lib/settings";
import { tasksBlock, type TaskStatus } from "@/lib/tasks";
import { parseProposal, ACTION_DEFS } from "@/lib/approvals";
import { connectedProviders, proposeAction } from "@/lib/server/approvals";
import { logActivity } from "@/lib/server/activity";
import type { Db } from "@/lib/server/auth";
import type { LLMMessage } from "@/lib/llm";
import { executeToolCall, loadToolsForUser, toOpenAITools, toolsPrompt, SEP, META_TOOL, type LoadedTool } from "@/lib/connectors/loadTools";
import { getConnector } from "@/lib/connectors/registry";
import { UNTRUSTED_RULES } from "@/lib/connectors/safety";
import { checkLimit, LIMITS, tooMany } from "@/lib/connectors/rateLimit";
import { runAgent, type ToolCall } from "@/lib/agent";
import { resolveModel, visionModels, type ContentPart, type ModelRef } from "@/lib/llm";
import { loadPreferredModel } from "@/lib/settings";
import { attachmentContext, claimableAttachments, conversationAttachments, linkAttachments, parseAttachmentIds } from "@/lib/server/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createClient();
  const db = supabase as unknown as Db;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await checkLimit(LIMITS.chat(user.id)))) return tooMany();

  let body: { conversationId?: unknown; projectId?: unknown; message?: unknown; web?: unknown; retry?: unknown; regenerate?: unknown; taskId?: unknown; resume?: unknown; attachmentIds?: unknown; model?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const att = parseAttachmentIds(body.attachmentIds);
  if (!att.ok) return Response.json({ error: att.error }, { status: 400 });
  let text = (typeof body.message === "string" ? body.message : "").trim();
  if (!text && att.ids.length) text = att.ids.length > 1 ? "Please take a look at the attached files." : "Please take a look at the attached file.";
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 8000) return Response.json({ error: "Message too long" }, { status: 400 });
  if (body.conversationId !== undefined && !isUuid(body.conversationId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  if (body.projectId !== undefined && !isUuid(body.projectId)) return Response.json({ error: "Project not found" }, { status: 404 });
  if (body.taskId !== undefined && !isUuid(body.taskId)) return Response.json({ error: "Task not found" }, { status: 404 });

  let conversationId = body.conversationId as string | undefined;
  let projectId: string | null = null;
  if (conversationId) {
    const { data: owned } = await supabase.from("conversations").select("id, project_id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
    if (!owned) return Response.json({ error: "Chat not found" }, { status: 404 });
    projectId = (owned.project_id as string | null) ?? null;
  } else {
    if (body.projectId) {
      const { data: proj } = await supabase.from("projects").select("id").eq("id", body.projectId as string).eq("user_id", user.id).maybeSingle();
      if (!proj) return Response.json({ error: "Project not found" }, { status: 404 });
      projectId = proj.id as string;
    }
  }

  // Task being worked on from this chat (optional). Must belong to the user.
  type TaskRef = { id: string; title: string; status: TaskStatus; project_id: string | null; needs_connector?: string | null; conversation_id?: string | null };
  let task: TaskRef | null = null;
  if (body.taskId) {
    const { data: t } = await supabase.from("tasks").select("id, title, status, project_id, needs_connector, conversation_id").eq("id", body.taskId as string).eq("user_id", user.id).maybeSingle();
    if (!t) return Response.json({ error: "Task not found" }, { status: 404 });
    task = t as unknown as TaskRef;
    if (!conversationId && !projectId && task.project_id) projectId = task.project_id;
  }

  // New files for this message: must be the user's own, unsent, and not from another chat.
  const newFiles = await claimableAttachments(db, user.id, att.ids, conversationId);
  if (!newFiles) return Response.json({ error: "Attachment not found" }, { status: 404 });

  if (!conversationId) {
    const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: titleFrom(task?.title ?? text), project_id: projectId }).select("id").single();
    if (error || !data) return Response.json({ error: "Could not create chat" }, { status: 500 });
    conversationId = data.id as string;
  }
  const convId = conversationId;

  const { data: historyRaw, error: hErr } = await supabase
    .from("messages").select("id, role, content").eq("conversation_id", convId)
    .order("created_at", { ascending: true }).limit(40);
  if (hErr) return Response.json({ error: "Could not load chat" }, { status: 500 });
  const historyRows = (historyRaw ?? []) as (ChatMsg & { id?: string })[];
  let history: ChatMsg[] = historyRows.map((m) => ({ role: m.role, content: m.content }));

  // Regenerate: drop the last assistant reply to this same user message, then answer it again like a retry.
  if (body.regenerate === true && history[history.length - 1]?.role === "assistant") {
    const prev = history[history.length - 2];
    const lastRow = historyRows[historyRows.length - 1];
    if (prev?.role === "user" && prev.content === text && lastRow?.id) {
      const { error: delErr } = await supabase.from("messages").delete().eq("id", lastRow.id).eq("conversation_id", convId);
      if (!delErr) { historyRows.pop(); history = history.slice(0, -1); body.retry = true; }
    }
  }

  // Retry: the user message is already stored (the reply failed or was stopped) — don't store it twice.
  const last = history[history.length - 1];
  const isRetry = body.retry === true && last?.role === "user" && last.content === text;
  const currentIds = new Set(att.ids);
  if (isRetry) {
    history = history.slice(0, -1);
    const lastId = historyRows[historyRows.length - 1]?.id;
    if (lastId) (await conversationAttachments(db, user.id, convId)).filter((r) => r.message_id === lastId).forEach((r) => currentIds.add(r.id));
    if (newFiles.length) await linkAttachments(db, user.id, att.ids, convId, lastId ?? null);
  } else {
    const { data: saved, error: insErr } = await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "user", content: text }).select("id").single();
    if (insErr) return Response.json({ error: "Could not save your message" }, { status: 500 });
    if (newFiles.length) await linkAttachments(db, user.id, att.ids, convId, (saved?.id as string | undefined) ?? null);
  }

  // Attachments: file text as untrusted context; images to a vision-capable model when one is configured.
  const vision = visionModels();
  const allFiles = await conversationAttachments(db, user.id, convId);
  const files = await attachmentContext(db, allFiles, currentIds, vision.length > 0);
  const only: ModelRef[] | undefined = files.imageParts.length ? vision : undefined;
  // Model picker: validated against the configured allow-list; the rest stay as fallback.
  const kind = detectTask(text);
  const picked = body.model !== undefined ? resolveModel(body.model) : resolveModel(await loadPreferredModel(supabase, user.id));
  // The user's own model pick always wins; otherwise use a model that is strong at this kind of task.
  const prefer = picked ?? (only ? null : taskModel(kind));
  const maxTokens = isMultiTask(text) ? Math.max(MAX_TOKENS[kind], 6144) : MAX_TOKENS[kind];

  const settings = await loadSettings(supabase, user.id);

  // Long-term memory (skipped entirely when the user has turned memory off)
  let known: string[] = [];
  let explicit: string | null = null;
  let savedExplicit = false;
  if (settings.memory_enabled) {
    const { data: memRows } = await supabase.from("memories").select("content").eq("user_id", user.id).order("created_at", { ascending: true }).limit(MAX_MEMORIES);
    known = (memRows ?? []).map((m) => m.content as string);
    explicit = explicitRemember(text);
    if (explicit && looksSecret(explicit)) explicit = null; // never keep passwords, keys or card numbers
    if (explicit && !isDuplicate(explicit, known)) {
      const { error } = await supabase.from("memories").insert({ user_id: user.id, content: explicit, source: "explicit" });
      if (!error) { known.push(explicit); savedExplicit = true; }
    }
  }
  const memNote = savedExplicit ? `\n(You just saved this to memory: "${explicit}". Confirm briefly.)`
    : !settings.memory_enabled && explicitRemember(text) ? "\n(The user has turned memory off in Settings, so nothing is saved. Tell them briefly if they ask you to remember something.)" : "";

  let project: { name: string; instructions: string; description?: string } | null = null;
  if (projectId) {
    const { data: p } = await supabase.from("projects").select("name, instructions, description").eq("id", projectId).eq("user_id", user.id).maybeSingle();
    project = (p as typeof project) ?? null;
    await supabase.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId).eq("user_id", user.id);
  }

  let taskQuery = supabase.from("tasks").select("title, status").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(30);
  if (projectId) taskQuery = taskQuery.eq("project_id", projectId);
  const { data: openTasks } = await taskQuery;
  const taskNote = (openTasks ? tasksBlock(openTasks as { title: string; status: TaskStatus }[]) : "") +
    (task ? `\n\nThe user opened this chat to work on their task "${task.title}". Help them make concrete progress on it.` : "");

  // Connectors: only tools of connectors this user has connected are offered to the model.
  let loaded: { tools: LoadedTool[]; connected: Set<string> } = { tools: [], connected: new Set() };
  try { loaded = await loadToolsForUser(user.id, db); } catch { /* connectors unavailable (e.g. migration 0007 not applied) */ }
  const toolSpecs = toOpenAITools(loaded.tools, loaded.connected);
  const resumed = body.resume === true && task?.needs_connector && loaded.connected.has(task.needs_connector) ? getConnector(task.needs_connector) : undefined;
  const connectorNote = toolSpecs.length ? toolsPrompt(loaded.tools, loaded.connected) + UNTRUSTED_RULES : "";
  const resumeNote = resumed ? `\n\nThe user has just connected ${resumed.name}. Continue the task that was paused waiting for it, using its tools.` : "";

  if (task) {
    await supabase.from("tasks").update({ status: "planning", needs_connector: null, conversation_id: convId, error: null, progress: "TARGET is reading the context…", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);
    await logActivity(db, user.id, { category: "task", title: `Started working on “${task.title}”`, status: "planning", task_id: task.id, project_id: task.project_id });
  }

  // Live web search (Tavily) when asked or when the question needs fresh info
  let webNote = "";
  let found: SearchResult | null = null;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey && (body.web === true || needsSearch(text))) {
    const q = searchQuery(text);
    try {
      found = await tavilySearch(q, tavilyKey);
      webNote = searchBlock(q, found);
    } catch {
      webNote = "\n\n(Live web search failed just now. If the answer needs current info, say so briefly instead of guessing.)";
    }
  } else if (body.web === true && !tavilyKey) {
    webNote = "\n\n(The user asked for a web search, but web search isn't set up on this server. Say so briefly and answer from general knowledge, clearly labelled as possibly out of date.)";
  }

  // Read links the user pasted (public pages only, capped), so questions about a link get real answers.
  let pageNote = "";
  const links = extractUrls(text);
  if (links.length) {
    try { pageNote = pagesBlock(await Promise.all(links.map((u) => readUrl(u)))); } catch { pageNote = ""; }
  }

  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + PLAYBOOKS[kind] + (isMultiTask(text) ? MULTI_PLAYBOOK : "") + CAPABILITIES + BLOCKS_PROMPT + nowLine() + projectBlock(project) + taskNote + memoryBlock(known) + memNote + webNote + pageNote + files.block + connectorNote + resumeNote },
    ...history,
    files.imageParts.length ? { role: "user", content: [{ type: "text", text }, ...files.imageParts] as ContentPart[] } : { role: "user", content: text },
  ];

  const failTask = async (msg: string) => {
    if (!task) return;
    await supabase.from("tasks").update({ status: "failed", error: msg.slice(0, 400), progress: "TARGET couldn't finish this step.", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);
    await logActivity(db, user.id, { category: "outcome", title: `Failed: “${task.title}”`, detail: msg, status: "failed", task_id: task.id, project_id: task.project_id });
  };

  let upstream: Response;
  let toolsOff = false;
  try {
    try {
      upstream = await llm({ messages, stream: true, timeoutMs: 30000, maxTokens, tools: toolSpecs.length ? toolSpecs : undefined, prefer, only });
    } catch (e) {
      // The model/provider can't do tool calling: ordinary chat still works, without connector tools.
      if (!(e instanceof LLMError) || !e.toolsRejected) throw e;
      toolsOff = true;
      upstream = await llm({ messages: messages.map((m) => (m.role === "system" ? { ...m, content: String(m.content).replace(connectorNote, "") } : m)), stream: true, timeoutMs: 30000, maxTokens, prefer, only });
    }
  } catch (e) {
    const err = e instanceof LLMError ? e : new LLMError("AI error", 502);
    await failTask(err.message);
    return Response.json({ error: err.message, conversationId: convId }, { status: err.status, headers: { "X-Conversation-Id": convId } });
  }
  if (task) await supabase.from("tasks").update({ status: "in_progress", progress: "TARGET is writing a reply…", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { if (cancelled) return; try { controller.enqueue(encoder.encode(s)); } catch { cancelled = true; } };
      let full = "";
      let interrupted = false;
      let paused = false;
      try {
        if (toolsOff && loaded.connected.size) { const n = "_(Connector tools aren't available with the AI model answering right now, so this reply can't use your connected apps.)_\n\n"; full += n; send(n); }
        const result = await runAgent({
          messages, first: upstream,
          next: (msgs) => llm({ messages: msgs, stream: true, timeoutMs: 30000, maxTokens, tools: toolSpecs, prefer, only }),
          onText: (d) => { full += d; send(d); },
          label: (call: ToolCall) => toolLabel(call.function.name),
          onTool: (call: ToolCall) => executeToolCall({ db, userId: user.id, projectId, conversationId: convId, taskId: task?.id ?? null }, call.function.name, call.function.arguments, loaded),
          cancelled: () => cancelled,
        });
        if (result.interrupted && !cancelled) { interrupted = true; send("\n\n[connection interrupted]"); }
        if (result.hitLimit) { const n = "\n\n_I stopped after several tool steps. Tell me to continue if you want me to keep going._"; full += n; send(n); }
        if (result.pause?.kind === "needs_connection") {
          paused = true;
          const c = getConnector(result.pause.connector);
          const name = c?.name ?? result.pause.connector;
          const why = result.pause.status === "expired" ? `Your ${name} connection has expired.` : `To do this I need access to your ${name} account.`;
          let taskId = task?.id ?? null;
          const patch = { status: "needs_connection", needs_connector: result.pause.connector, conversation_id: convId, progress: `Waiting for you to connect ${name}.`, updated_at: new Date().toISOString() };
          if (taskId) await supabase.from("tasks").update(patch).eq("id", taskId).eq("user_id", user.id);
          else {
            const { data: t } = await supabase.from("tasks").insert({ user_id: user.id, title: titleFrom(text), origin: "assistant", project_id: projectId, ...patch }).select("id").single();
            taskId = (t?.id as string) ?? null;
          }
          await logActivity(db, user.id, { category: "task", title: `Paused: needs ${name}`, detail: "Connect it to let TARGET continue.", status: "needs_connection", task_id: taskId, project_id: projectId });
          const block = `\n\n${why} ${result.pause.status === "expired" ? "Reconnect it" : "Connect it"} below and I'll pick up where I left off.\n\n\`\`\`actions\n${JSON.stringify([{ type: "connect", connector: result.pause.connector, ...(taskId ? { taskId } : {}) }])}\n\`\`\``;
          full += block; send(block);
        } else if (result.pause?.kind === "approval") {
          paused = true;
          const block = `\n\nI've prepared this for your approval: **${result.pause.summary.replace(/[*_`]/g, "")}**. Nothing happens until you approve it.\n\n\`\`\`actions\n${JSON.stringify([{ type: "approval", id: result.pause.approvalId }])}\n\`\`\``;
          full += block; send(block);
        }
      } catch {
        if (!cancelled) { interrupted = true; send("\n\n[connection interrupted]"); }
      } finally {
        if (cancelled && full) full += "\n\n_[Response stopped]_";
        if (!cancelled && full && found?.results.length) {
          const src = sourcesFence(found);
          full += src; send(src);
        }
        if (!cancelled && full && text.length >= 12 && !/```actions?/i.test(full)) {
          try {
            const { actions, proposals } = await suggestActions(text, full);
            const extra: Action[] = [];
            if (proposals.length) {
              const connected = await connectedProviders(db, user.id);
              for (const pr of proposals.slice(0, 3)) {
                if (!pr.ok) {
                  const def = pr.action ? ACTION_DEFS[pr.action] : undefined;
                  if (def?.unavailable) extra.push({ type: "unavailable", label: `Can't ${def.label.toLowerCase()}`, reason: def.unavailable });
                  continue;
                }
                const r = await proposeAction(db, user.id, pr.value, { projectId, conversationId: convId, connected });
                extra.push(r.ok ? { type: "approval", id: r.approval.id as string } : { type: "unavailable", label: `Can't ${(ACTION_DEFS[pr.value.action]?.label ?? "do that").toLowerCase()}`, reason: r.reason });
              }
            }
            const acts = [...extra, ...mergeActions(heuristicActions(text), actions)].slice(0, 5);
            if (acts.length) {
              const blockText = "\n\n```actions\n" + JSON.stringify(acts) + "\n```";
              full += blockText; send(blockText);
            }
          } catch { /* buttons are best-effort */ }
        }
        if (full) {
          await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "assistant", content: full });
          await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId).eq("user_id", user.id);
        }
        if (task && !paused) {
          if (interrupted || !full) await failTask(interrupted ? "The AI connection was interrupted." : "The AI returned an empty reply.");
          else {
            await supabase.from("tasks").update({ status: "in_progress", progress: cancelled ? "You stopped TARGET's reply." : "TARGET replied in chat. Review it, then mark the task done.", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);
            await logActivity(db, user.id, { category: "task", title: cancelled ? `Stopped reply for “${task.title}”` : `TARGET replied on “${task.title}”`, detail: "Open the chat to review it.", status: "in_progress", task_id: task.id, project_id: task.project_id });
          }
        }
        if (!cancelled && settings.memory_enabled && !explicit) {
          try {
            const facts = await extractFacts(text, known);
            const fresh: string[] = [];
            for (const f of facts) if (!isDuplicate(f, [...known, ...fresh])) fresh.push(f);
            if (fresh.length && known.length < MAX_MEMORIES)
              await supabase.from("memories").insert(fresh.map((content) => ({ user_id: user.id, content, source: "chat" })));
          } catch { /* memory is best-effort */ }
        }
        try { controller.close(); } catch { /* already closed by cancel */ }
      }
    },
    cancel() {
      // The browser pressed Stop (or went away): the agent loop sees `cancelled` and stops reading.
      cancelled = true;
      upstream.body?.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Conversation-Id": convId },
  });
}

async function extractFacts(text: string, known: string[]): Promise<string[]> {
  if (text.length < 8) return [];
  const raw = await llmText({
    temperature: 0, maxTokens: 300,
    messages: [
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: `Already known:\n${known.slice(-50).map((k) => "- " + k).join("\n") || "(nothing)"}\n\nLatest user message:\n${text}` },
    ],
  });
  return parseFacts(raw);
}

/** "Supabase · run sql" for a tool step note. Never includes arguments (they may contain data). */
function toolLabel(name: string): string {
  if (name === META_TOOL) return "Checking which account is needed";
  const [cid, t] = name.split(SEP);
  if (cid === BUILTIN_ID) return getBuiltin(t ?? "")?.label ?? "Working";
  const c = getConnector(cid ?? "");
  return c && t ? `${c.name} · ${t.replace(/_/g, " ")}` : "Tool";
}

function nowLine(): string {
  const tz = { timeZone: "Asia/Kolkata" } as const;
  const now = new Date().toLocaleString("en-IN", { ...tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  const day = (n: number) => {
    const d = new Date(Date.now() + n * 86400000);
    return `${d.toLocaleDateString("en-CA", tz)} (${d.toLocaleDateString("en-IN", { ...tz, weekday: "long" })})`;
  };
  return ` Current date-time: ${now} IST (UTC+05:30). Today = ${day(0)}; tomorrow ("kal") = ${day(1)}; day after ("parso") = ${day(2)}.`;
}

/** Ask the model for buttons. Ordinary buttons are sanitized; "propose" items are validated against the action catalogue. */
async function suggestActions(userText: string, reply: string): Promise<{ actions: Action[]; proposals: ReturnType<typeof parseProposal>[] }> {
  const raw = await llmText({
    temperature: 0, maxTokens: 500,
    messages: [
      { role: "system", content: "You pick action buttons for a chat reply." + nowLine() + ACTIONS_PROMPT +
        "\nReply with ONLY the JSON array (no fence, no prose). Return [] for small talk or when no button clearly helps." },
      { role: "user", content: `User said:\n${userText}\n\nAssistant replied:\n${reply.slice(0, 3000)}` },
    ],
  });
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return { actions: [], proposals: [] };
    const arr = JSON.parse(m[0]);
    const list = Array.isArray(arr) ? arr : [];
    const proposals = list.filter((x) => x && typeof x === "object" && x.type === "propose").map(parseProposal);
    // The model may not mint approval cards or limitation notes itself; only the server creates those.
    const actions = list.filter((x) => x && typeof x === "object" && x.type !== "propose" && x.type !== "approval" && x.type !== "unavailable" && x.type !== "connect")
      .map(sanitizeAction).filter((x): x is Action => !!x).slice(0, 3);
    return { actions, proposals };
  } catch {
    return { actions: [], proposals: [] };
  }
}
