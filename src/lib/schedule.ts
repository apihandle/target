import { cleanMultiline, cleanText, isUuid } from "@/lib/ids";

/** Scheduled prompts: recurring daily/weekly runs at a local time in the user's timezone. */

export type Cadence = "daily" | "weekly";
export type JobStatus = "active" | "paused";
export type ScheduledJob = {
  id: string; user_id?: string; project_id: string | null; title: string; prompt: string; cadence: Cadence; weekday: number | null;
  time_of_day: string; timezone: string; status: JobStatus; next_run_at: string | null; last_run_at: string | null;
  last_status: string | null; last_error: string | null; last_task_id: string | null; run_count: number; created_at?: string;
};
export const JOB_COLS = "id, project_id, title, prompt, cadence, weekday, time_of_day, timezone, status, next_run_at, last_run_at, last_status, last_error, last_task_id, run_count, created_at";
export const MAX_JOBS_PER_USER = 25;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0); return true; } catch { return false; }
}

const TIME_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

type JobInput = Pick<ScheduledJob, "title" | "prompt" | "cadence" | "weekday" | "time_of_day" | "timezone" | "project_id">;

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
    if (input.cadence !== "daily" && input.cadence !== "weekly") return { ok: false, error: "Choose daily or weekly", field: "cadence" };
    v.cadence = input.cadence;
  }
  if (!partial || input.weekday !== undefined || input.cadence !== undefined) {
    const cadence = v.cadence;
    if (cadence === "weekly" || (cadence === undefined && input.weekday !== undefined && input.weekday !== null)) {
      const wd = typeof input.weekday === "string" ? Number(input.weekday) : input.weekday;
      if (typeof wd !== "number" || !Number.isInteger(wd) || wd < 0 || wd > 6) return { ok: false, error: "Pick a day of the week", field: "weekday" };
      v.weekday = wd;
    } else if (cadence === "daily") v.weekday = null;
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

/** The next run strictly after `from`. */
export function nextRunAt(job: Pick<ScheduledJob, "cadence" | "weekday" | "time_of_day" | "timezone">, from: Date = new Date()): Date {
  const [h, mi] = job.time_of_day.split(":").map(Number);
  const tz = isValidTimeZone(job.timezone) ? job.timezone : "UTC";
  const { y, m, d } = localDate(from.getTime(), tz);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (job.cadence === "weekly" && day.getUTCDay() !== job.weekday) continue;
    const t = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, tz);
    if (t > from.getTime()) return new Date(t);
  }
  // Unreachable for valid input; fall back to a day later.
  return new Date(from.getTime() + 86400000);
}

export function describeSchedule(job: Pick<ScheduledJob, "cadence" | "weekday" | "time_of_day" | "timezone">): string {
  const [h, mi] = job.time_of_day.split(":").map(Number);
  const t = `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return `${job.cadence === "weekly" ? `Every ${WEEKDAYS[job.weekday ?? 0]}` : "Every day"} at ${t} (${job.timezone})`;
}

/** "Current date-time: … (Asia/Kolkata)" line for scheduled runs in the job's timezone. */
export function nowLineFor(tz: string, now = new Date()): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const s = now.toLocaleString("en-IN", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  return ` Current date-time: ${s} (${zone}).`;
}
