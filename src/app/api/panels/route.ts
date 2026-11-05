import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { MANUAL_KINDS, PANEL_COLS, validatePanel } from "@/lib/panels";
import { computePanelData } from "@/lib/panels-server";
import { withAiUsage } from "@/lib/aiUsage";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("panels").select(PANEL_COLS).eq("user_id", a.user.id).order("position").order("created_at");
  if (error) return dbError(error, "Could not load panels");
  return json({ panels: data });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validatePanel(body);
  if (!v.ok) return badRequest(v.error);
  const { count } = await a.db.from("panels").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= 20) return badRequest("Home is full (20 panels)");
  // Gather data before saving so a bad city / coin fails fast instead of leaving a broken panel.
  let data: Record<string, unknown> | null = {};
  if (!MANUAL_KINDS.includes(v.value.kind) || v.value.kind === "countdown") {
    try { data = await withAiUsage({ userId: a.user.id, feature: "panels" }, () => computePanelData(v.value)); } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Couldn't load data" }, 422);
    }
  }
  const { data: row, error } = await a.db.from("panels")
    .insert({ user_id: a.user.id, ...v.value, data, refreshed_at: new Date().toISOString(), position: count ?? 0 })
    .select(PANEL_COLS).single();
  if (error || !row) return dbError(error, "Could not save panel");
  await logActivity(a.db, a.user.id, { category: "panel", title: `Panel added: “${v.value.title}”` });
  return json({ panel: row }, 201);
}
