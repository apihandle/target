import { createClient } from "@/lib/supabase/server";
import { MAX_MEMORIES, MAX_MEMORY_LEN, cleanFact, isDuplicate } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase.from("memories").select("id, content, source, created_at").order("created_at", { ascending: false }).limit(MAX_MEMORIES);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ memories: data });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { content?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const raw = (body.content ?? "").trim();
  if (raw.length > MAX_MEMORY_LEN) return Response.json({ error: "Too long" }, { status: 400 });
  const content = cleanFact(raw);
  if (content.length < 2) return Response.json({ error: "Empty memory" }, { status: 400 });
  const { data: existing } = await supabase.from("memories").select("content").limit(MAX_MEMORIES);
  const list = (existing ?? []).map((m) => m.content as string);
  if (list.length >= MAX_MEMORIES) return Response.json({ error: "Memory is full" }, { status: 400 });
  if (isDuplicate(content, list)) return Response.json({ error: "Already remembered" }, { status: 409 });
  const { data, error } = await supabase.from("memories").insert({ user_id: user.id, content, source: "manual" }).select("id, content, source, created_at").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ memory: data }, { status: 201 });
}

export async function DELETE() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await supabase.from("memories").delete().eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
