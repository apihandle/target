export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type Project = {
  id: string; name: string; instructions: string; description?: string; status?: ProjectStatus;
  archived_at?: string | null; created_at?: string; updated_at?: string;
};
export const PROJECT_COLS = "id, name, instructions, description, status, archived_at, created_at, updated_at";
export const MAX_PROJECT_NAME = 80;
export const MAX_INSTRUCTIONS = 4000;
export const MAX_DESCRIPTION = 1000;

type Value = { name?: string; instructions?: string; description?: string; status?: ProjectStatus };

export function validateProject(input: { name?: unknown; instructions?: unknown; description?: unknown; status?: unknown }, partial = false):
  { ok: true; value: Value } | { ok: false; error: string; field?: string } {
  const value: Value = {};
  if (input.name !== undefined || !partial) {
    if (typeof input.name !== "string") return { ok: false, error: "Name is required", field: "name" };
    const name = input.name.replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, error: "Name is required", field: "name" };
    if (name.length > MAX_PROJECT_NAME) return { ok: false, error: "Name is too long", field: "name" };
    value.name = name;
  }
  if (input.instructions !== undefined) {
    if (typeof input.instructions !== "string") return { ok: false, error: "Bad instructions", field: "instructions" };
    const ins = input.instructions.trim();
    if (ins.length > MAX_INSTRUCTIONS) return { ok: false, error: "Instructions are too long", field: "instructions" };
    value.instructions = ins;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string") return { ok: false, error: "Bad description", field: "description" };
    const d = input.description.trim();
    if (d.length > MAX_DESCRIPTION) return { ok: false, error: "Purpose is too long (1000 max)", field: "description" };
    value.description = d;
  }
  if (input.status !== undefined) {
    if (!PROJECT_STATUSES.includes(input.status as ProjectStatus)) return { ok: false, error: "Unknown status", field: "status" };
    value.status = input.status as ProjectStatus;
  }
  if (partial && !Object.keys(value).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value };
}

export function projectBlock(p: { name: string; instructions: string; description?: string } | null | undefined): string {
  if (!p) return "";
  return `\n\nThis chat belongs to the user's project "${p.name}". Keep your answers in the context of this project.` +
    (p.description ? ` Project purpose: ${p.description}` : "") +
    (p.instructions ? ` Follow the project's standing instructions:\n${p.instructions}` : "");
}
