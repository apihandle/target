import { json } from "@/lib/server/auth";
import { adminNotFound, requireAdmin } from "@/lib/server/adminAuth";
import { auditFailure, auditFirst, readConfirmed } from "@/lib/server/adminWrite";
import { loadAdminSettings, saveAdminSetting } from "@/lib/server/adminSettings";
import { ANNOUNCEMENT_MAX, FEATURES, MAINTENANCE_MAX, type Feature } from "@/lib/adminConfig";

export const dynamic = "force-dynamic";

/** Current admin settings (announcement, maintenance, kill-switches), read fresh. */
export async function GET() {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  return json({ settings: await loadAdminSettings(a.db) });
}

/**
 * Change one setting. Body: { key: "announcement", value: { enabled, text } } | { key: "maintenance", value: { enabled, message } }
 * | { key: "features", value: { <feature>: boolean, ... } } (merged into the current switches), plus confirm: true.
 */
export async function POST(req: Request) {
  const a = await requireAdmin();
  if (!a) return adminNotFound();
  const c = await readConfirmed(req);
  if (c instanceof Response) return c;
  const { key } = c.body;
  const v = c.body.value && typeof c.body.value === "object" && !Array.isArray(c.body.value) ? (c.body.value as Record<string, unknown>) : null;
  if (!v) return json({ error: "value must be an object" }, 400);
  const current = await loadAdminSettings(a.db);

  let value: Record<string, unknown>;
  let detail: Record<string, unknown>;
  if (key === "announcement") {
    if (typeof v.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
    const text = typeof v.text === "string" ? v.text.trim() : "";
    if (text.length > ANNOUNCEMENT_MAX) return json({ error: `Keep the announcement under ${ANNOUNCEMENT_MAX} characters.` }, 400);
    if (v.enabled && !text) return json({ error: "Write the announcement text first." }, 400);
    value = { enabled: v.enabled, text };
    detail = { enabled: v.enabled, text: text.slice(0, 120) };
  } else if (key === "maintenance") {
    if (typeof v.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
    const message = typeof v.message === "string" ? v.message.trim() : "";
    if (message.length > MAINTENANCE_MAX) return json({ error: `Keep the message under ${MAINTENANCE_MAX} characters.` }, 400);
    value = { enabled: v.enabled, message };
    detail = { enabled: v.enabled };
  } else if (key === "features") {
    const changes: Partial<Record<Feature, boolean>> = {};
    for (const [k, b] of Object.entries(v)) {
      if (!(FEATURES as readonly string[]).includes(k) || typeof b !== "boolean") return json({ error: `Unknown switch: ${k.slice(0, 40)}` }, 400);
      changes[k as Feature] = b;
    }
    if (!Object.keys(changes).length) return json({ error: "Nothing to change" }, 400);
    value = { ...current.features, ...changes };
    detail = { changes };
  } else {
    return json({ error: "Unknown setting" }, 400);
  }

  const entry = { action: `settings.${key}`, targetType: "setting", targetId: key, detail };
  const blocked = await auditFirst(a, entry);
  if (blocked) return blocked;
  if (!(await saveAdminSetting(a.db, key, value, a.user.id))) {
    await auditFailure(a.db, a, entry, "save failed");
    return json({ error: "Could not save the setting" }, 502);
  }
  return json({ ok: true, settings: await loadAdminSettings(a.db) });
}
