/**
 * Pure admin-panel definitions (no server imports), shared by the server, the /admin UI and tests.
 */

/** Feature kill-switches. A missing value means ON: switching a feature off is always an explicit admin action. */
export const FEATURES = ["browser", "email_send", "checkout", "booking", "scheduled", "custom_providers"] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureFlags = Record<Feature, boolean>;

export const FEATURE_LABELS: Record<Feature, { title: string; description: string }> = {
  browser: { title: "Browser tasks", description: "Website tasks, sign-ins, account creation and the browser workers" },
  email_send: { title: "Email send", description: "Sending, replying and forwarding Gmail (drafts still work)" },
  checkout: { title: "Checkout", description: "Store orders through the browser" },
  booking: { title: "Booking", description: "Reservations and appointments through the browser" },
  scheduled: { title: "Scheduled tasks", description: "New scheduled prompts and the scheduled cron runs" },
  custom_providers: { title: "Custom AI providers", description: "Users' own OpenAI-compatible models (chat falls back to Auto)" },
};

export const ALL_ON: FeatureFlags = { browser: true, email_send: true, checkout: true, booking: true, scheduled: true, custom_providers: true };

export function normalizeFlags(v: unknown): FeatureFlags {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...ALL_ON };
  for (const f of FEATURES) if (o[f] === false) out[f] = false;
  return out;
}

export type Announcement = { enabled: boolean; text: string };
export type Maintenance = { enabled: boolean; message: string };
export const ANNOUNCEMENT_MAX = 300;
export const MAINTENANCE_MAX = 300;

export function normalizeAnnouncement(v: unknown): Announcement {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const text = typeof o.text === "string" ? o.text.trim().slice(0, ANNOUNCEMENT_MAX) : "";
  return { enabled: o.enabled === true && !!text, text };
}
export function normalizeMaintenance(v: unknown): Maintenance {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { enabled: o.enabled === true, message: typeof o.message === "string" ? o.message.trim().slice(0, MAINTENANCE_MAX) : "" };
}

export const DISABLED_MESSAGE: Record<Feature, string> = {
  browser: "Browser tasks are turned off on TARGET right now. Please try again later.",
  email_send: "Sending email is turned off on TARGET right now. The draft is safe; please try again later.",
  checkout: "Store checkout is turned off on TARGET right now. Please try again later.",
  booking: "Booking is turned off on TARGET right now. Please try again later.",
  scheduled: "Scheduled prompts are turned off on TARGET right now. Please try again later.",
  custom_providers: "Custom AI providers are turned off on TARGET right now. Chat uses the built-in models.",
};

const EMAIL_SEND_TOOLS = new Set(["gmail_send", "gmail_send_draft", "gmail_reply", "gmail_reply_all", "gmail_forward"]);
const BROWSER_BUILTINS = new Set(["browser_task", "site_login", "site_register", "site_password_reset"]);

/** Features a model tool call (e.g. "target__checkout", "google__gmail_send") depends on. */
export function featuresForTool(name: string): Feature[] {
  const [cid, tool] = name.split("__");
  if (!tool) return [];
  if (cid === "target") {
    if (tool === "checkout") return ["checkout", "browser"];
    if (tool === "book") return ["booking", "browser"];
    if (BROWSER_BUILTINS.has(tool)) return ["browser"];
    return [];
  }
  if (cid === "google" && EMAIL_SEND_TOOLS.has(tool)) return ["email_send"];
  return [];
}

/** Features an approved action (approval_requests.action_type + payload) depends on when it executes. */
export function featuresForApproval(actionType: string, payload: unknown): Feature[] {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  switch (actionType) {
    case "purchase": return ["checkout", "browser"];
    case "reservation": return ["booking", "browser"];
    case "site_account": return ["browser"];
    case "create_schedule": return ["scheduled"];
    case "connector_tool": return p.connector === "google" && typeof p.tool === "string" && EMAIL_SEND_TOOLS.has(p.tool) ? ["email_send"] : [];
    default: return [];
  }
}

/** The first switched-off feature in the list, or null when everything needed is on. */
export function firstDisabled(flags: FeatureFlags, needed: Feature[]): Feature | null {
  return needed.find((f) => !flags[f]) ?? null;
}

/** ADMIN_EMAILS: comma (or whitespace/semicolon) separated, case-insensitive. */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  return Array.from(new Set((raw ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"))));
}

/** One CSV cell: quoted, quotes doubled, and formula-looking text neutralised (CSV injection). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const PAGE_SIZE = 25;
export function pageFrom(v: unknown): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

/** Supabase auth ban length used for "Disable user": long enough to mean "until enabled again". */
export const BAN_DURATION = "876000h";
