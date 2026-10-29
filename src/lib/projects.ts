export type Project = { id: string; name: string; instructions: string; created_at?: string; updated_at?: string };
export const MAX_PROJECT_NAME = 80;
export const MAX_INSTRUCTIONS = 4000;

export function validateProject(input: { name?: unknown; instructions?: unknown }, partial = false):
  { ok: true; value: { name?: string; instructions?: string } } | { ok: false; error: string } {
  const value: { name?: string; instructions?: string } = {};
  if (input.name !== undefined || !partial) {
    if (typeof input.name !== "string") return { ok: false, error: "Name is required" };
    const name = input.name.replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, error: "Name is required" };
    if (name.length > MAX_PROJECT_NAME) return { ok: false, error: "Name is too long" };
    value.name = name;
  }
  if (input.instructions !== undefined) {
    if (typeof input.instructions !== "string") return { ok: false, error: "Bad instructions" };
    const ins = input.instructions.trim();
    if (ins.length > MAX_INSTRUCTIONS) return { ok: false, error: "Instructions are too long" };
    value.instructions = ins;
  }
  if (partial && !Object.keys(value).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value };
}

export function projectBlock(p: { name: string; instructions: string } | null | undefined): string {
  if (!p) return "";
  return `\n\nThis chat belongs to the user's project "${p.name}".` +
    (p.instructions ? ` Follow the project's standing instructions:\n${p.instructions}` : "");
}
