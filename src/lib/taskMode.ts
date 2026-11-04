/**
 * Task mode (owner decision 2026-11-04): with task mode on in a chat, TARGET doesn't stop to ask. Approval cards are
 * approved automatically in code and shown as "Done automatically", except two kinds that always wait for the user:
 * payments (any money spend) and deletes (every destructive delete / trash / drop / remove).
 */
export type AutoDecision = { auto: true } | { auto: false; why: "payment" | "delete" };
type ApprovalLike = { action_type: string; summary?: string | null; payload?: Record<string, unknown> | null };

/** Tool names that delete something: delete_repo, drive_trash, gmail_trash, remove_domain, delete_env_var... */
const DELETE_TOOL = /(^|_)(delete|deleted|remove|trash|drop|destroy|purge|erase|wipe)(_|$)/i;
/** SQL that destroys data. */
const DELETE_SQL = /\b(drop|delete|truncate)\b/i;
const DELETE_SUMMARY = /^\s*(delete|permanently delete|remove|trash|drop|erase|destroy|wipe)\b/i;

/** A price that costs something ("₹450", "$12.99", "1,200"); "free", "0" and empty don't. */
export function looksLikeMoney(v: unknown): boolean {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s || /^(free|none|n\/a|-)$/i.test(s)) return false;
  const n = Number((s.match(/\d[\d,]*(\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0;
}

export function taskModeDecision(a: ApprovalLike): AutoDecision {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  if (a.action_type === "purchase") return { auto: false, why: "payment" };
  if (a.action_type === "reservation" && (looksLikeMoney(p.price) || (typeof p.payment === "string" && p.payment.trim()))) return { auto: false, why: "payment" };
  if (a.action_type === "connector_tool") {
    const tool = String(p.tool ?? "");
    if (DELETE_TOOL.test(tool)) return { auto: false, why: "delete" };
    const args = (p.args ?? {}) as Record<string, unknown>;
    const sql = [args.sql, args.query, args.migration, args.statements].filter((x) => typeof x === "string").join("\n");
    if (/(run_sql|apply_migration|query)/i.test(tool) && DELETE_SQL.test(sql)) return { auto: false, why: "delete" };
  }
  if (DELETE_SUMMARY.test(a.summary ?? "")) return { auto: false, why: "delete" };
  return { auto: true };
}

/** "/task ..." or "task mode on" turns task mode on for the chat; "task mode off" turns it off. */
export function taskModeCommand(text: string): { on: boolean; text: string } | null {
  const m = text.match(/^\s*\/task\b[:\s]*/i);
  if (m) return { on: true, text: text.slice(m[0].length).trim() || text.trim() };
  if (/\btask ?mode\s+(on|chalu|shuru|start|enable|enabled|karo on)\b/i.test(text)) return { on: true, text };
  if (/\btask ?mode\s+(off|band|bandh|stop|disable|disabled)\b/i.test(text)) return { on: false, text };
  return null;
}

/** Added to the system prompt only while task mode is on. */
export const TASK_MODE_PROMPT =
  "\n\nTASK MODE is on for this chat (the owner turned it on). Finish the task without stopping to ask the user anything: " +
  "when you would ask a clarifying question (which option, which account, a missing detail), pick the most reasonable choice yourself and say in the result which choice you made and why, in one short line. " +
  "Actions you prepare run automatically and show as Done automatically, except payments and deletes, which still wait for the user's approval card. " +
  "So never tell the user to tap Approve for anything else (a reminder or schedule is set automatically: say it is set). Never invent survey answers or personal details.";

export const AUTO_LINE = "Done automatically";
