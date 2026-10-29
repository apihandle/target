import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MODEL, SYSTEM_PROMPT, parseSSE, titleFrom, type ChatMsg } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { conversationId?: string; message?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const text = (body.message ?? "").trim();
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
  if (text.length > 8000) return Response.json({ error: "Message too long" }, { status: 400 });

  let conversationId = body.conversationId;
  if (!conversationId) {
    const { data, error } = await supabase.from("conversations").insert({ user_id: user.id, title: titleFrom(text) }).select("id").single();
    if (error || !data) return Response.json({ error: error?.message ?? "Could not create chat" }, { status: 500 });
    conversationId = data.id as string;
  }

  const { data: history, error: hErr } = await supabase
    .from("messages").select("role, content").eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }).limit(40);
  if (hErr) return Response.json({ error: hErr.message }, { status: 500 });

  await supabase.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", content: text });

  const messages: ChatMsg[] = [{ role: "system", content: SYSTEM_PROMPT }, ...((history ?? []) as ChatMsg[]), { role: "user", content: text }];

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
    body: JSON.stringify({ model: DEFAULT_MODEL, messages, stream: true }),
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Conversation-Id": convId },
  });
}
