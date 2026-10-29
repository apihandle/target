import { createClient } from "@/lib/supabase/server";
import { validatePanel } from "@/lib/panels";
import { computePanelData } from "@/lib/panels-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const COLS = "id, kind, title, config, data, error, refreshed_at, position";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase.from("panels").select(COLS).order("position").order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ panels: data });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const v = validatePanel(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const { count } = await supabase.from("panels").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 20) return Response.json({ error: "Home is full (20 panels)" }, { status: 400 });
  // Gather data before saving so a bad city / coin fails fast instead of leaving a broken panel.
  let data: Record<string, unknown> | null = null;
  try { data = await computePanelData(v.value); } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't load data" }, { status: 422 });
  }
  const { data: row, error } = await supabase.from("panels")
    .insert({ user_id: user.id, ...v.value, data, refreshed_at: new Date().toISOString(), position: count ?? 0 })
    .select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ panel: row }, { status: 201 });
}
