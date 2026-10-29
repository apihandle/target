import { createClient } from "@/lib/supabase/server";
import { MODELS, SYSTEM_PROMPT, parseSSE, titleFrom, type ChatMsg } from "@/lib/ai";
import { projectBlock } from "@/lib/projects";
import { EXTRACT_PROMPT, MAX_MEMORIES, explicitRemember, isDuplicate, memoryBlock, parseFacts } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { conversationId?: string; projectId?: string; message?: string };
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

  const messages: ChatMsg[] = [{ role: "system", content: SYSTEM_PROMPT + projectBlock(project) + memoryBlock(known) + memNote }, ...((history ?? []) as ChatMsg[]), { role: "user", content: text }];

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ error: "AI is not configured" }, { status: 503 });

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://gettarget.vercel.app",
      "X-Title": "TARGET",
    },
    body: JSON.stringify({ model: MODELS[0], models: MODELS, messages, stream: true, reasoning: { enabled: false } }),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json({ error: `AI error ${upstream.status}`, detail: detail.slice(0, 300) }, { status: 502 });
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
        if (full) {
          await supabase.from("messages").insert({ conversation_id: convId, user_id: user.id, role: "assistant", content: full });
          await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
        }
        if (!explicit) {
          try {
            const facts = await extractFacts(key, text, known);
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

async function extractFacts(key: string, text: string, known: string[]): Promise<string[]> {
  if (text.length < 8) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://gettarget.vercel.app", "X-Title": "TARGET" },
      body: JSON.stringify({
        model: MODELS[0], models: MODELS, reasoning: { enabled: false }, temperature: 0,
        messages: [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: `Already known:\n${known.slice(-50).map((k) => "- " + k).join("\n") || "(nothing)"}\n\nLatest user message:\n${text}` },
        ],
      }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return parseFacts(j.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timer);
  }
}
