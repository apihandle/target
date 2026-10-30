import { cleanText } from "@/lib/ids";

export type QuickAction = { id: string; label: string; prompt: string; target: "chat" | "new_project" };

/** Defaults shown until the user edits their own. They only pre-fill a chat; nothing runs on click. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: "plan-week", label: "Plan my week", prompt: "Help me plan my week. Ask me what's on my plate, then suggest a simple day-by-day plan.", target: "chat" },
  { id: "summarize-tasks", label: "Summarize my tasks", prompt: "Summarize my open tasks in TARGET and suggest what to do first.", target: "chat" },
  { id: "new-project", label: "Start a new project", prompt: "", target: "new_project" },
  { id: "research", label: "Research a topic", prompt: "Research this topic for me and give me the key points with sources: ", target: "chat" },
];

export type UserSettings = { memory_enabled: boolean; quick_actions: QuickAction[]; hidden_quick_actions: string[] };

export function resolveSettings(row: { memory_enabled?: boolean | null; quick_actions?: unknown; hidden_quick_actions?: string[] | null } | null | undefined): UserSettings {
  const qa = validateQuickActions(row?.quick_actions);
  return {
    memory_enabled: row?.memory_enabled !== false,
    quick_actions: row?.quick_actions && qa.ok ? qa.value : DEFAULT_QUICK_ACTIONS,
    hidden_quick_actions: Array.isArray(row?.hidden_quick_actions) ? row!.hidden_quick_actions!.filter((x) => typeof x === "string").slice(0, 20) : [],
  };
}

export function validateQuickActions(raw: unknown): { ok: true; value: QuickAction[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Quick actions must be a list" };
  if (raw.length > 8) return { ok: false, error: "At most 8 quick actions" };
  const out: QuickAction[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") return { ok: false, error: "Bad quick action" };
    const x = r as Record<string, unknown>;
    const label = cleanText(x.label, 41);
    if (!label) return { ok: false, error: "Each quick action needs a label" };
    if (label.length > 40) return { ok: false, error: "Labels are limited to 40 characters" };
    const target = x.target === "new_project" ? "new_project" : "chat";
    const prompt = typeof x.prompt === "string" ? x.prompt.trim().slice(0, 500) : "";
    if (target === "chat" && !prompt) return { ok: false, error: `“${label}” needs a prompt` };
    let id = typeof x.id === "string" && /^[a-z0-9-]{1,40}$/.test(x.id) ? x.id : label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "qa";
    while (seen.has(id)) id = `${id}-x`.slice(0, 40);
    seen.add(id);
    out.push({ id, label, prompt, target });
  }
  return { ok: true, value: out };
}

/** Where a quick action goes. It opens a workflow with the intent filled in; it never runs anything. */
export function quickActionHref(q: QuickAction): string {
  return q.target === "new_project" ? "/app/projects?new=1" : `/app?q=${encodeURIComponent(q.prompt)}`;
}

export async function loadSettings(db: { from: (t: string) => any }, userId: string): Promise<UserSettings> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data } = await db.from("user_settings").select("memory_enabled, quick_actions, hidden_quick_actions").eq("user_id", userId).maybeSingle();
    return resolveSettings(data);
  } catch {
    return resolveSettings(null);
  }
}

/**
 * The model the user last picked ("provider:model"), or null for automatic. Read separately from
 * loadSettings so a database without migration 0008 never affects memory/quick-action settings.
 */
export async function loadPreferredModel(db: { from: (t: string) => any }, userId: string): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data, error } = await db.from("user_settings").select("preferred_model").eq("user_id", userId).maybeSingle();
    if (error) return null;
    return typeof data?.preferred_model === "string" ? data.preferred_model : null;
  } catch {
    return null;
  }
}
