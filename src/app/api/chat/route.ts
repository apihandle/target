import { createClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT, parseSSE, titleFrom, type ChatMsg } from "@/lib/ai";
import { llm, llmText, LLMError } from "@/lib/llm";
import { ACTIONS_PROMPT, heuristicActions, mergeActions, sanitizeAction, type Action } from "@/lib/actions";
import { projectBlock } from "@/lib/projects";
import { needsSearch, searchBlock, searchQuery, sourcesFence, tavilySearch, type SearchResult } from "@/lib/search";
import { EXTRACT_PROMPT, MAX_MEMORIES, explicitRemember, isDuplicate, memoryBlock, parseFacts } from "@/lib/memory";
import { isUuid } from "@/lib/ids";
import { loadSettings } from "@/lib/settings";
import { tasksBlock, type TaskStatus } from "@/lib/tasks";
import { parseProposal, ACTION_DEFS } from "@/lib/approvals";
import { connectedProviders, proposeAction } from "@/lib/server/approvals";
import { logActivity } from "@/lib/server/activity";
import type { Db } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const db = supabase as unknown as Db;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { conversationId?: unknown; projectId?: unknown; message?: unknown; web?: unknown; retry?: unknown; taskId?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const text = (typeof body.message === "string" ? body.message : "").trim();
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
  type TaskRef = { id: string; title: string; status: TaskStatus; project_id: string | null };
  let task: TaskRef | null = null;
  if (body.taskId) {
    const { data: t } = await supabase.from("tasks").select("id, title, status, project_id").eq("id", body.taskId as string).eq("user_id", user.id).maybeSingle();
    if (!t) return Response.json({ error: "Task not found" }, { status: 404 });
    task = t as unknown as TaskRef;
    if (!conversationId && !projectId && task.project_id) projectId = task.project_id;
  }

  if (!conversationId) {
    const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: titleFrom(task?.title ?? text), project_id: projectId }).select("id").single();
    if (error || !data) return Response.json({ error: "Could not create chat" }, { status: 500 });
    conversationId = data.id as string;
  }
  const convId = conversationId;

  const { data: historyRaw, error: hErr } = await supabase
    .from("messages").select("role, content").eq("conversation_id", convId)
    .order("created_at", { ascending: true }).limit(40);
  if (hErr) return Response.json({ error: "Could not load chat" }, { status: 500 });
  let history = (historyRaw ?? []) as ChatMsg[];

  // Retry: the user message is already stored (the reply failed or was stopped) — don't store it twice.
  const last = history[history.length - 1];
  const isRetry = body.retry === true && last?.role === "user" && last.content === text;
  if (isRetry) history = history.slice(0, -1);
  else {
    const { error: insErr } = await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "user", content: text });
    if (insErr) return Response.json({ error: "Could not save your message" }, { status: 500 });
  }

  const settings = await loadSettings(supabase, user.id);

  // Long-term memory (skipped entirely when the user has turned memory off)
  let known: string[] = [];
  let explicit: string | null = null;
  let savedExplicit = false;
  if (settings.memory_enabled) {
    const { data: memRows } = await supabase.from("memories").select("content").eq("user_id", user.id).order("created_at", { ascending: true }).limit(MAX_MEMORIES);
    known = (memRows ?? []).map((m) => m.content as string);
    explicit = explicitRemember(text);
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

  if (task) {
    await supabase.from("tasks").update({ status: "planning", conversation_id: convId, error: null, progress: "TARGET is reading the context…", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);
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

  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM_PROMPT + nowLine() + projectBlock(project) + taskNote + memoryBlock(known) + memNote + webNote },
    ...history, { role: "user", content: text },
  ];

  const failTask = async (msg: string) => {
    if (!task) return;
    await supabase.from("tasks").update({ status: "failed", error: msg.slice(0, 400), progress: "TARGET couldn't finish this step.", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);
    await logActivity(db, user.id, { category: "outcome", title: `Failed: “${task.title}”`, detail: msg, status: "failed", task_id: task.id, project_id: task.project_id });
  };

  let upstream: Response;
  try {
    upstream = await llm({ messages, stream: true, timeoutMs: 30000 });
  } catch (e) {
    const err = e instanceof LLMError ? e : new LLMError("AI error", 502);
    await failTask(err.message);
    return Response.json({ error: err.message, conversationId: convId }, { status: err.status, headers: { "X-Conversation-Id": convId } });
  }
  if (task) await supabase.from("tasks").update({ status: "in_progress", progress: "TARGET is writing a reply…", updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", user.id);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => { if (cancelled) return; try { controller.enqueue(encoder.encode(s)); } catch { cancelled = true; } };
      reader = upstream.body!.getReader();
      let buf = "";
      let full = "";
      let interrupted = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          buf += decoder.decode(value, { stream: true });
          const { deltas, rest } = parseSSE(buf);
          buf = rest;
          for (const d of deltas) { full += d; send(d); }
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
              for (const pr of proposals.slice(0, 1)) {
                if (!pr.ok) {
                  const def = pr.action ? ACTION_DEFS[pr.action] : undefined;
                  if (def?.unavailable) extra.push({ type: "unavailable", label: `Can't ${def.label.toLowerCase()}`, reason: def.unavailable });
                  continue;
                }
                const r = await proposeAction(db, user.id, pr.value, { projectId, conversationId: convId, connected });
                extra.push(r.ok ? { type: "approval", id: r.approval.id as string } : { type: "unavailable", label: `Can't ${(ACTION_DEFS[pr.value.action]?.label ?? "do that").toLowerCase()}`, reason: r.reason });
              }
            }
            const acts = [...mergeActions(heuristicActions(text), actions), ...extra].slice(0, 4);
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
        if (task) {
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
      // The browser pressed Stop (or went away): stop reading from the model.
      cancelled = true;
      reader?.cancel().catch(() => undefined);
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
    const actions = list.filter((x) => x && typeof x === "object" && x.type !== "propose" && x.type !== "approval" && x.type !== "unavailable")
      .map(sanitizeAction).filter((x): x is Action => !!x).slice(0, 3);
    return { actions, proposals };
  } catch {
    return { actions: [], proposals: [] };
  }
}
