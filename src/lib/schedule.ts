import { cleanMultiline, cleanText, isUuid } from "@/lib/ids";

/** Scheduled prompts: one-time reminders, every-N-hours, daily or weekly runs at a local time in the user's timezone. */

export type Cadence = "daily" | "weekly" | "once" | "interval";
export const CADENCES: Cadence[] = ["once", "interval", "daily", "weekly"];
export type JobStatus = "active" | "paused" | "done";
export type ScheduledJob = {
  id: string; user_id?: string; project_id: string | null; title: string; prompt: string; cadence: Cadence; weekday: number | null; run_on?: string | null; interval_hours?: number | null;
  time_of_day: string; timezone: string; status: JobStatus; next_run_at: string | null; last_run_at: string | null;
  last_status: string | null; last_error: string | null; last_task_id: string | null; run_count: number; created_at?: string; allow_browser?: boolean;
};
export const JOB_COLS = "id, project_id, title, prompt, cadence, weekday, run_on, interval_hours, time_of_day, timezone, status, next_run_at, last_run_at, last_status, last_error, last_task_id, run_count, created_at, allow_browser";
export const MAX_JOBS_PER_USER = 25;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0); return true; } catch { return false; }
}

const TIME_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

type JobInput = Pick<ScheduledJob, "title" | "prompt" | "cadence" | "weekday" | "run_on" | "interval_hours" | "time_of_day" | "timezone" | "project_id"> & { allow_browser?: boolean };
type When = Pick<ScheduledJob, "cadence" | "weekday" | "time_of_day" | "timezone"> & { run_on?: string | null; interval_hours?: number | null };
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate a new job (or, with partial=true, a patch). */
export function validateJob(input: Record<string, unknown>, partial = false): { ok: true; value: Partial<JobInput> & { status?: JobStatus } } | { ok: false; error: string; field?: string } {
  const v: Partial<JobInput> & { status?: JobStatus } = {};
  if (!partial || input.prompt !== undefined) {
    const prompt = cleanMultiline(input.prompt, 4001);
    if (!prompt) return { ok: false, error: "Write the prompt TARGET should run", field: "prompt" };
    if (prompt.length > 4000) return { ok: false, error: "Prompt is too long (4000 max)", field: "prompt" };
    v.prompt = prompt;
  }
  if (!partial || input.title !== undefined) {
    let title = cleanText(input.title, 121);
    if (!title && v.prompt) title = cleanText(v.prompt, 60);
    if (!title) return { ok: false, error: "Give it a name", field: "title" };
    if (title.length > 120) return { ok: false, error: "Name is too long (120 max)", field: "title" };
    v.title = title;
  }
  if (!partial || input.cadence !== undefined) {
    if (!CADENCES.includes(input.cadence as Cadence)) return { ok: false, error: "Choose once, every few hours, daily or weekly", field: "cadence" };
    v.cadence = input.cadence as Cadence;
  }
  if (v.cadence === "once" || (v.cadence === undefined && input.run_on !== undefined && input.run_on !== null)) {
    const m = typeof input.run_on === "string" ? DATE_RE.exec(input.run_on) : null;
    const ok = m && (() => { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; })();
    if (!ok) return { ok: false, error: "Pick a date", field: "run_on" };
    v.run_on = input.run_on as string;
  } else if (v.cadence) v.run_on = null;
  if (v.cadence === "interval" || (v.cadence === undefined && input.interval_hours !== undefined && input.interval_hours !== null)) {
    const n = typeof input.interval_hours === "string" ? Number(input.interval_hours) : input.interval_hours;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 168) return { ok: false, error: "Every 1 to 168 hours", field: "interval_hours" };
    v.interval_hours = n;
  } else if (v.cadence) v.interval_hours = null;
  if (!partial || input.weekday !== undefined || input.cadence !== undefined) {
    const cadence = v.cadence;
    if (cadence === "weekly" || (cadence === undefined && input.weekday !== undefined && input.weekday !== null)) {
      const wd = typeof input.weekday === "string" ? Number(input.weekday) : input.weekday;
      if (typeof wd !== "number" || !Number.isInteger(wd) || wd < 0 || wd > 6) return { ok: false, error: "Pick a day of the week", field: "weekday" };
      v.weekday = wd;
    } else if (cadence) v.weekday = null;
  }
  if (!partial || input.time_of_day !== undefined) {
    if (typeof input.time_of_day !== "string" || !TIME_RE.test(input.time_of_day)) return { ok: false, error: "Time must look like 09:00", field: "time_of_day" };
    v.time_of_day = input.time_of_day;
  }
  if (!partial || input.timezone !== undefined) {
    const tz = input.timezone === undefined || input.timezone === "" ? "Asia/Kolkata" : input.timezone;
    if (!isValidTimeZone(tz)) return { ok: false, error: "Unknown timezone", field: "timezone" };
    v.timezone = tz;
  }
  if (input.project_id !== undefined || input.projectId !== undefined) {
    const pid = input.project_id ?? input.projectId;
    if (pid !== null && pid !== "" && !isUuid(pid)) return { ok: false, error: "Unknown project", field: "project_id" };
    v.project_id = isUuid(pid) ? pid : null;
  } else if (!partial) v.project_id = null;
  if (input.allow_browser !== undefined) {
    if (typeof input.allow_browser !== "boolean") return { ok: false, error: "allow_browser must be true or false", field: "allow_browser" };
    v.allow_browser = input.allow_browser;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "paused") return { ok: false, error: "Status must be active or paused", field: "status" };
    v.status = input.status;
  }
  if (partial && !Object.keys(v).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: v };
}

/** Minutes to add to UTC to get local time in `tz` at instant `t`. */
export function tzOffsetMinutes(t: number, tz: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
}

/** UTC instant of a local wall-clock time in `tz` (DST gaps move forward, overlaps take the first). */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(guess, tz);
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return t;
}

function localDate(t: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** The next run strictly after `from`, or null when a one-time reminder's moment has passed. */
export function nextRunAt(job: When, from: Date = new Date()): Date | null {
  const [h, mi] = job.time_of_day.split(":").map(Number);
  const tz = isValidTimeZone(job.timezone) ? job.timezone : "UTC";
  if (job.cadence === "once") {
    const m = DATE_RE.exec(job.run_on ?? "");
    if (!m) return null;
    const t = zonedTimeToUtc(+m[1], +m[2], +m[3], h, mi, tz);
    return t > from.getTime() ? new Date(t) : null;
  }
  const { y, m, d } = localDate(from.getTime(), tz);
  if (job.cadence === "interval") {
    const step = Math.min(168, Math.max(1, job.interval_hours ?? 1)) * 3600000;
    const anchor = zonedTimeToUtc(y, m, d, h, mi, tz);
    const k = Math.floor((from.getTime() - anchor) / step) + 1;
    return new Date(anchor + k * step);
  }
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (job.cadence === "weekly" && day.getUTCDay() !== job.weekday) continue;
    const t = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, tz);
    if (t > from.getTime()) return new Date(t);
  }
  // Unreachable for valid input; fall back to a day later.
  return new Date(from.getTime() + 86400000);
}

export function describeSchedule(job: When): string {
  const [h, mi] = job.time_of_day.split(":").map(Number);
  const t = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  if (job.cadence === "once") {
    const m = DATE_RE.exec(job.run_on ?? "");
    const day = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "a date";
    return `Once on ${day} at ${t} (${job.timezone})`;
  }
  if (job.cadence === "interval") { const n = job.interval_hours ?? 1; return `Every ${n === 1 ? "hour" : `${n} hours`} from ${t} (${job.timezone})`; }
  return `${job.cadence === "weekly" ? `Every ${WEEKDAYS[job.weekday ?? 0]}` : "Every day"} at ${t} (${job.timezone})`;
}

/** "Current date-time: … (Asia/Kolkata)" line for scheduled runs in the job's timezone. */
export function nowLineFor(tz: string, now = new Date()): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const s = now.toLocaleString("en-IN", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  return ` Current date-time: ${s} (${zone}).`;
}
