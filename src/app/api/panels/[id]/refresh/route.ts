import { createClient } from "@/lib/supabase/server";
import { computePanelData } from "@/lib/panels-server";
import type { Panel } from "@/lib/panels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const COLS = "id, kind, title, config, data, error, refreshed_at, position";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: p } = await supabase.from("panels").select(COLS).eq("id", params.id).maybeSingle();
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  // Throttle: one refresh per panel per minute.
  if (p.refreshed_at && Date.now() - new Date(p.refreshed_at as string).getTime() < 60_000 && !p.error)
    return Response.json({ panel: p, throttled: true });
  let update: Record<string, unknown>;
  try {
    update = { data: await computePanelData(p as Panel), error: null, refreshed_at: new Date().toISOString() };
  } catch (e) {
    update = { error: e instanceof Error ? e.message : "Refresh failed" };
  }
  const { data: row, error } = await supabase.from("panels").update(update).eq("id", params.id).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ panel: row });
}
