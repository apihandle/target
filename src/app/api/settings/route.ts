import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { loadPreferredModel, loadSettings, validateQuickActions } from "@/lib/settings";
import { AUTO_MODEL, resolveModel } from "@/lib/llm";
import { logActivity } from "@/lib/server/activity";
import { ownsCustomModel } from "@/lib/server/customProviders";
import { parseCustomModelId } from "@/lib/customProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data: pro } = await a.db.from("user_settings").select("proactive_enabled").eq("user_id", a.user.id).maybeSingle();
  return json({ settings: { ...(await loadSettings(a.db, a.user.id)), preferred_model: await loadPreferredModel(a.db, a.user.id), proactive_enabled: pro?.proactive_enabled !== false } });
}

export async function PATCH(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const row: Record<string, unknown> = { user_id: a.user.id, updated_at: new Date().toISOString() };
  if (body.memory_enabled !== undefined) {
    if (typeof body.memory_enabled !== "boolean") return badRequest("memory_enabled must be true or false");
    row.memory_enabled = body.memory_enabled;
  }
  if (body.proactive_enabled !== undefined) {
    if (typeof body.proactive_enabled !== "boolean") return badRequest("proactive_enabled must be true or false");
    row.proactive_enabled = body.proactive_enabled;
  }
  if (body.quick_actions !== undefined) {
    if (body.quick_actions === null) row.quick_actions = null; // reset to defaults
    else {
      const v = validateQuickActions(body.quick_actions);
      if (!v.ok) return badRequest(v.error);
      row.quick_actions = v.value;
    }
  }
  if (body.hidden_quick_actions !== undefined) {
    const h = body.hidden_quick_actions;
    if (!Array.isArray(h) || h.length > 20 || h.some((x) => typeof x !== "string" || x.length > 40)) return badRequest("Bad hidden list");
    row.hidden_quick_actions = h;
  }
  if (body.preferred_model !== undefined) {
    // Remembered model choice: one of the server's configured models, one of this user's own custom models, or "auto"/null.
    if (body.preferred_model === null || body.preferred_model === AUTO_MODEL) row.preferred_model = null;
    else if (parseCustomModelId(body.preferred_model)) {
      if (!(await ownsCustomModel(a.db, a.user.id, body.preferred_model))) return badRequest("That model isn't available");
      row.preferred_model = body.preferred_model;
    } else {
      const m = resolveModel(body.preferred_model);
      if (!m) return badRequest("That model isn't available");
      row.preferred_model = m.id;
    }
  }
  if (Object.keys(row).length === 2) return badRequest("Nothing to update");
  const { error } = await a.db.from("user_settings").upsert(row, { onConflict: "user_id" });
  if (error) return dbError(error, "Could not save settings");
  if (row.memory_enabled !== undefined)
    await logActivity(a.db, a.user.id, { category: "memory", title: row.memory_enabled ? "Memory turned on" : "Memory turned off" });
  return json({ settings: { ...(await loadSettings(a.db, a.user.id)), ...(row.preferred_model !== undefined ? { preferred_model: row.preferred_model } : {}) } });
}
