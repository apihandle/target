import { validateJob, describeSchedule, type Cadence } from "@/lib/schedule";
import { cleanMultiline, cleanText } from "@/lib/ids";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled", "executing", "executed", "failed"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type Approval = {
  id: string; action_type: string; summary: string; destination: string; payload: Record<string, unknown>;
  status: ApprovalStatus; project_id: string | null; conversation_id: string | null; task_id: string | null;
  decided_at: string | null; executed_at: string | null; result: Record<string, unknown> | null; error: string | null;
  created_at: string;
};
export const APPROVAL_COLS = "id, action_type, summary, destination, payload, status, project_id, conversation_id, task_id, decided_by, decided_at, executed_at, result, error, created_at";

/** Mirrors the database trigger in migration 0006. */
const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: ["executing", "cancelled"],
  executing: ["executed", "failed"],
  failed: ["approved", "cancelled"],
  rejected: [], cancelled: [], executed: [],
};
export function canMoveApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export const STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: "Needs your approval", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
  executing: "Running", executed: "Done", failed: "Failed",
};

// ------------------------------------------------------------------ action catalogue

export type Params = Record<string, string>;
type Def = {
  label: string;
  /** Integration the action needs; null = runs inside TARGET. */
  provider: string | null;
  /** Actions that can never be executed in this build. */
  unavailable?: string;
  /** Created only by the server (connector agent loop); the model's action buttons can't propose it. */
  internal?: boolean;
  validate(raw: Record<string, unknown>): { ok: true; params: Params } | { ok: false; error: string };
  describe(p: Params): { summary: string; destination: string };
};

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";
};

export const ACTION_DEFS: Record<string, Def> = {
  create_task: {
    label: "Add a task", provider: null,
    validate(r) {
      const title = cleanText(r.title, 200);
      if (!title) return { ok: false, error: "Task needs a title" };
      return { ok: true, params: { title, notes: cleanMultiline(r.notes, 2000) } };
    },
    describe: (p) => ({ summary: `Add the task “${p.title}”`, destination: "TARGET · Tasks" }),
  },
  create_project: {
    label: "Start a project", provider: null,
    validate(r) {
      const name = cleanText(r.name, 80);
      if (!name) return { ok: false, error: "Project needs a name" };
      return { ok: true, params: { name, description: cleanMultiline(r.description, 1000) } };
    },
    describe: (p) => ({ summary: `Create the project “${p.name}”`, destination: "TARGET · Projects" }),
  },
  create_schedule: {
    label: "Schedule a prompt", provider: null,
    validate(r) {
      const v = validateJob({ title: r.title, prompt: r.prompt, cadence: r.cadence, weekday: r.cadence === "weekly" ? r.weekday : null,
        run_on: r.cadence === "once" ? r.run_on : null, interval_hours: r.cadence === "interval" ? r.interval_hours : null, time_of_day: r.time_of_day, timezone: r.timezone || "Asia/Kolkata" });
      if (!v.ok) return { ok: false, error: v.error };
      const j = v.value;
      return { ok: true, params: { title: j.title!, prompt: j.prompt!, cadence: j.cadence!, weekday: j.weekday === null || j.weekday === undefined ? "" : String(j.weekday),
        run_on: j.run_on ?? "", interval_hours: j.interval_hours ? String(j.interval_hours) : "", time_of_day: j.time_of_day!, timezone: j.timezone! } };
    },
    describe: (p) => ({
      summary: `Run “${p.title}” ${describeSchedule({ cadence: p.cadence as Cadence, weekday: p.weekday === "" ? null : Number(p.weekday), run_on: p.run_on || null, interval_hours: p.interval_hours ? Number(p.interval_hours) : null, time_of_day: p.time_of_day, timezone: p.timezone })}`,
      destination: "TARGET · Scheduled",
    }),
  },
  calendar_event: {
    label: "Add to Google Calendar", provider: "google",
    validate(r) {
      const title = cleanText(r.title, 120), start = cleanText(r.start, 60), end = cleanText(r.end, 60);
      if (!title) return { ok: false, error: "Event needs a title" };
      if (isNaN(Date.parse(start))) return { ok: false, error: "Event needs a valid start time" };
      const startIso = new Date(start).toISOString();
      const endIso = end && !isNaN(Date.parse(end)) ? new Date(end).toISOString() : new Date(Date.parse(start) + 3600000).toISOString();
      if (Date.parse(endIso) <= Date.parse(startIso)) return { ok: false, error: "Event must end after it starts" };
      return { ok: true, params: { title, start: startIso, end: endIso, location: cleanText(r.location, 200), details: cleanMultiline(r.details, 1000) } };
    },
    describe: (p) => ({ summary: `Add “${p.title}” on ${fmtWhen(p.start)}${p.location ? ` at ${p.location}` : ""}`, destination: "Your Google Calendar (primary)" }),
  },
  connector_tool: {
    label: "Connector action", provider: null, internal: true,
    validate(r) {
      const connector = cleanText(r.connector, 30), tool = cleanText(r.tool, 60);
      if (!/^[a-z][a-z0-9_]{1,29}$/.test(connector) || !/^[a-z][a-z0-9_]{1,59}$/.test(tool)) return { ok: false, error: "Bad connector action" };
      return { ok: true, params: { connector, tool } };
    },
    describe: (p) => ({ summary: `${p.connector}: ${p.tool.replace(/_/g, " ")}`, destination: p.connector }),
  },
  send_email: {
    label: "Send an email", provider: "gmail",
    unavailable: "Ask TARGET in the chat to send it from your connected Gmail: you'll get an approval card with the full email, and nothing is sent until you approve.",
    validate: () => ({ ok: true, params: {} }),
    describe: () => ({ summary: "Send an email", destination: "Email" }),
  },
  /** Created only by the checkout tool: approving it hands the prepared order to the browser worker. */
  purchase: {
    label: "Order", provider: null, internal: true,
    validate(r) {
      const id = typeof r.browser_job_id === "string" ? r.browser_job_id : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Bad order" };
      return { ok: true, params: { browser_job_id: id } };
    },
    describe: () => ({ summary: "Place an order", destination: "Store" }),
  },
  /** Created only by site_register / site_password_reset: approving it generates the password into the vault and starts the browser. */
  site_account: {
    label: "Website account", provider: null, internal: true,
    validate(r) {
      const id = typeof r.browser_job_id === "string" ? r.browser_job_id : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Bad request" };
      return { ok: true, params: { browser_job_id: id } };
    },
    describe: () => ({ summary: "Website account", destination: "Website" }),
  },
  booking: {
    label: "Book or cancel something", provider: null,
    unavailable: "TARGET can't book or cancel reservations in this version. It can prepare the details for you to use.",
    validate: () => ({ ok: true, params: {} }),
    describe: () => ({ summary: "Book or cancel", destination: "External service" }),
  },
};

export type Availability = { available: true } | { available: false; reason: string };

/** Can this action actually be executed for this user right now? */
export function availability(type: string, ctx: { connected: ReadonlySet<string>; configured: (provider: string) => boolean }): Availability {
  const def = ACTION_DEFS[type];
  if (!def) return { available: false, reason: "TARGET doesn't support that action." };
  if (def.unavailable) return { available: false, reason: def.unavailable };
  if (def.provider) {
    if (!ctx.configured(def.provider)) return { available: false, reason: `${def.label} needs an integration that isn't set up on this TARGET server yet.` };
    if (!ctx.connected.has(def.provider)) return { available: false, reason: `Connect your account on the Connectors page to let TARGET ${def.label.toLowerCase()} (only after you approve).` };
  }
  return { available: true };
}

export type Proposal = { action: string; params: Params; summary: string; destination: string };

/** Turn the model's raw proposal into a validated one. The model never chooses summary/destination text. */
export function parseProposal(raw: unknown): { ok: true; value: Proposal } | { ok: false; action?: string; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Bad proposal" };
  const r = raw as Record<string, unknown>;
  const action = typeof r.action === "string" ? r.action : "";
  const def = ACTION_DEFS[action];
  if (!def || def.internal) return { ok: false, error: "Unknown action" };
  const v = def.validate(r);
  if (!v.ok) return { ok: false, action, error: v.error };
  return { ok: true, value: { action, params: v.params, ...def.describe(v.params) } };
}
