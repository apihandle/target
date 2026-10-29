import { createClient } from "@/lib/supabase/server";
import { SYSTEM_PROMPT, parseSSE, titleFrom, type ChatMsg } from "@/lib/ai";
import { llm, llmText, LLMError } from "@/lib/llm";
import { ACTIONS_PROMPT, heuristicActions, mergeActions, sanitizeAction, type Action } from "@/lib/actions";
import { projectBlock } from "@/lib/projects";
import { needsSearch, searchBlock, searchQuery, sourcesFence, tavilySearch, type SearchResult } from "@/lib/search";
import { EXTRACT_PROMPT, MAX_MEMORIES, explicitRemember, isDuplicate, memoryBlock, parseFacts } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { conversationId?: string; projectId?: string; message?: string; web?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const text = (body.message ?? "").trim();
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 8000) return Response.json({ error: "Message too long" }, { status: 400 });

  let conversationId = body.conversationId;
  let projectId: string | null = null;
  if (conversationId) {
    const { data: owned } = await supabase.from("conversations").select("id, project_id").eq("id", conversationId).maybeSingle();
    if (!owned) return Response.json({ error: "Chat not found" }, { status: 404 });
    projectId = (owned.project_id as string | null) ?? null;
  } else {
    if (body.projectId) {
      const { data: proj } = await supabase.from("projects").select("id").eq("id", body.projectId).maybeSingle();
      if (!proj) return Response.json({ error: "Project not found" }, { status: 404 });
      projectId = proj.id as string;
    }
    const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: titleFrom(text), project_id: projectId }).select("id").single();
    if (error || !data) return Response.json({ error: error?.message ?? "Could not create chat" }, { status: 500 });
    conversationId = data.id as string;
  }

  const { data: history, error: hErr } = await supabase
    .from("messages").select("role, content").eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }).limit(40);
  if (hErr) return Response.json({ error: hErr.message }, { status: 500 });

  const { error: insErr } = await supabase.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", content: text });
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

  // Feature 5: long-term memory
  const { data: memRows } = await supabase.from("memories").select("content").order("created_at", { ascending: true }).limit(MAX_MEMORIES);
  const known = (memRows ?? []).map((m) => m.content as string);
  const explicit = explicitRemember(text);
  let savedExplicit = false;
  if (explicit && !isDuplicate(explicit, known)) {
    const { error } = await supabase.from("memories").insert({ user_id: user.id, content: explicit, source: "explicit" });
    if (!error) { known.push(explicit); savedExplicit = true; }
  }
  const memNote = savedExplicit ? `\n(You just saved this to memory: "${explicit}". Confirm briefly.)` : "";

  let project: { name: string; instructions: string } | null = null;
  if (projectId) {
    const { data: p } = await supabase.from("projects").select("name, instructions").eq("id", projectId).maybeSingle();
    project = (p as { name: string; instructions: string } | null) ?? null;
    await supabase.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId);
  }

  // Feature 9: live web search (Tavily) when asked or when the question needs fresh info
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
  }

  const messages: ChatMsg[] = [{ role: "system", content: SYSTEM_PROMPT + nowLine() + projectBlock(project) + memoryBlock(known) + memNote + webNote }, ...((history ?? []) as ChatMsg[]), { role: "user", content: text }];

  let upstream: Response;
  try {
    upstream = await llm({ messages, stream: true, timeoutMs: 30000 });
  } catch (e) {
    const err = e instanceof LLMError ? e : new LLMError("AI error", 502);
    return Response.json({ error: err.message }, { status: err.status });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const convId = conversationId;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      let full = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { deltas, rest } = parseSSE(buf);
          buf = rest;
          for (const d of deltas) { full += d; controller.enqueue(encoder.encode(d)); }
        }
      } catch {
        controller.enqueue(encoder.encode("\n\n[connection interrupted]"));
      } finally {
        if (full && found?.results.length) {
          const src = sourcesFence(found);
          full += src;
          controller.enqueue(encoder.encode(src));
        }
        if (full && text.length >= 12 && !/```actions?/i.test(full)) {
          try {
            const acts = mergeActions(heuristicActions(text), await suggestActions(text, full));
            if (acts.length) {
              const blockText = "\n\n```actions\n" + JSON.stringify(acts) + "\n```";
              full += blockText;
              controller.enqueue(encoder.encode(blockText));
            }
          } catch { /* buttons are best-effort */ }
        }
        if (full) {
          await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "assistant", content: full });
          await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
        }
        if (!explicit) {
          try {
            const facts = await extractFacts(text, known);
            const fresh: string[] = [];
            for (const f of facts) if (!isDuplicate(f, [...known, ...fresh])) fresh.push(f);
            if (fresh.length && known.length < MAX_MEMORIES)
              await supabase.from("memories").insert(fresh.map((content) => ({ user_id: user.id, content, source: "chat" })));
          } catch { /* memory is best-effort */ }
        }
        controller.close();
      }
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

async function suggestActions(userText: string, reply: string): Promise<Action[]> {
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
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return (Array.isArray(arr) ? arr : []).map(sanitizeAction).filter((x): x is Action => !!x).slice(0, 3);
  } catch {
    return [];
  }
}
