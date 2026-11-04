import { z } from "zod";
import { clip, tool } from "@/lib/connectors/define";
import { ConnectorError } from "@/lib/connectors/http";
import type { ToolContext, ToolPreview } from "@/lib/connectors/types";
import { NEED, type GTool, calendarId, eventId, gcall, oneLine, qs, str } from "@/lib/connectors/google/shared";
import { addressList, parseAddresses } from "@/lib/connectors/google/mime";

const CAL = "https://www.googleapis.com/calendar/v3";
const evUrl = (cal: string, id?: string) => `${CAL}/calendars/${encodeURIComponent(cal)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDateTime = (s: string) => z.string().datetime({ offset: true }).safeParse(s).success;
/** An event time: RFC 3339 with an offset (2026-11-05T10:00:00+05:30), or a date (2026-11-05) for all-day events. */
const when = z.string().max(40).refine((s) => isDateTime(s) || DATE.test(s), "Use 2026-11-05T10:00:00+05:30, or 2026-11-05 for all day");
const tz = z.string().regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/).max(60).refine((z0) => { try { new Intl.DateTimeFormat("en", { timeZone: z0 }); return true; } catch { return false; } }, "Unknown time zone");
const rrule = z.array(z.string().regex(/^(RRULE|EXRULE|RDATE|EXDATE)[:;][^\r\n]{1,500}$/, "Use RFC 5545 lines like RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10")).max(5);
const time = (s: string, zone?: string) => (DATE.test(s) ? { date: s } : { dateTime: s, ...(zone ? { timeZone: zone } : {}) });

type Attendee = { email?: string; self?: boolean; resource?: boolean; organizer?: boolean; responseStatus?: string; displayName?: string; optional?: boolean };
type Event = Record<string, unknown> & {
  id?: string; summary?: string; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Attendee[]; organizer?: { email?: string; self?: boolean }; recurringEventId?: string; recurrence?: string[]; hangoutLink?: string;
  htmlLink?: string; status?: string; location?: string; description?: string; conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
};
const meetOf = (e: Event) => e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
const guestsOf = (e: Event) => (e.attendees ?? []).filter((x) => !x.self && !x.resource);
const fmtWhen = (e: Event) => {
  const s = e.start?.dateTime ?? e.start?.date ?? "";
  const t = Date.parse(s);
  if (!s || isNaN(t)) return s;
  return e.start?.date ? `${s} (all day)` : new Date(t).toLocaleString("en-IN", { timeZone: e.start?.timeZone || "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + ` (${e.start?.timeZone || "IST"})`;
};
const brief = (e: Event) => ({
  id: e.id, title: e.summary, start: e.start, end: e.end, location: e.location, status: e.status,
  ...(e.recurringEventId ? { recurring_event_id: e.recurringEventId } : {}), ...(meetOf(e) ? { meet: meetOf(e) } : {}),
  ...(e.attendees?.length ? { guests: e.attendees.length } : {}),
});
const meetRequest = () => ({ createRequest: { requestId: `target-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, conferenceSolutionKey: { type: "hangoutsMeet" } } });

async function calendarZone(ctx: ToolContext, cal: string): Promise<string | undefined> {
  try { return str((await gcall<{ timeZone?: string }>(ctx, `${CAL}/calendars/${encodeURIComponent(cal)}`)).timeZone) || undefined; } catch { return undefined; }
}

async function loadEvent(ctx: ToolContext, cal: string, id: string, series: boolean): Promise<Event> {
  const e = await gcall<Event>(ctx, evUrl(cal, id));
  if (series && e.recurringEventId) return gcall<Event>(ctx, evUrl(cal, e.recurringEventId));
  return e;
}

/** Other people on the event (not the user, not rooms). Without has_other_guests the server refuses to touch it. */
function requireGuestsAck(e: Event, ack: boolean | undefined, verb: string) {
  const g = guestsOf(e);
  if (g.length && !ack) throw new ConnectorError(`This event has ${g.length} other guest${g.length > 1 ? "s" : ""} (${g.map((x) => x.email).slice(0, 5).join(", ")}). To ${verb} it, call again with has_other_guests: true; the user approves it on a card and the guests are notified.`, 409, "invalid");
}

export type NewEvent = {
  title: string; start: string; end: string; location?: string; details?: string; calendar_id?: string; attendees?: string; time_zone?: string;
  recurrence?: string[]; add_meet?: boolean; notify?: boolean;
};

export async function createEvent(token: string, p: NewEvent, f: typeof fetch = fetch) {
  const ctx: ToolContext = { token, fetch: f, meta: {} };
  const cal = p.calendar_id || "primary";
  const attendees = (parseAddresses(p.attendees, 100) ?? []).map((email) => ({ email }));
  if (DATE.test(p.start) !== DATE.test(p.end)) throw new ConnectorError("Start and end must both be dates (all day) or both be times.", 400, "invalid");
  const zone = p.time_zone ?? (p.recurrence?.length && !DATE.test(p.start) ? await calendarZone(ctx, cal) ?? "UTC" : undefined);
  const j = await gcall<Event>(ctx, `${evUrl(cal)}${qs({ conferenceDataVersion: p.add_meet ? 1 : undefined, sendUpdates: attendees.length ? (p.notify === false ? "none" : "all") : undefined })}`, {
    method: "POST",
    body: { json: {
      summary: p.title, location: p.location || undefined, description: p.details || undefined, start: time(p.start, zone), end: time(p.end, zone),
      ...(attendees.length ? { attendees } : {}), ...(p.recurrence?.length ? { recurrence: p.recurrence } : {}), ...(p.add_meet ? { conferenceData: meetRequest() } : {}),
    } },
  });
  return { eventId: j.id ?? "", link: j.htmlLink ?? "", ...(meetOf(j) ? { meet: meetOf(j) } : {}) };
}

// ------------------------------------------------------------------ free time

/** Minutes east of UTC for `zone` at instant `ms`. */
export function zoneOffset(zone: string, ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
/** The UTC instant of a wall-clock time (y-m-d hh:mm) in `zone`. */
export function wallToUtc(zone: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = zoneOffset(zone, guess - zoneOffset(zone, guess) * 60000);
  return guess - off1 * 60000;
}

type Busy = { start: number; end: number };
/** Free slots of at least `minutes` inside working hours on each day of [from, to), avoiding busy blocks. */
export function freeSlots(busy: Busy[], o: { from: number; to: number; minutes: number; zone: string; dayStart: string; dayEnd: string; weekdaysOnly: boolean; max: number }): { start: string; end: string }[] {
  const merged = [...busy].sort((a, b) => a.start - b.start).reduce<Busy[]>((acc, b) => {
    const last = acc[acc.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end); else acc.push({ ...b });
    return acc;
  }, []);
  const [sh, sm] = o.dayStart.split(":").map(Number), [eh, em] = o.dayEnd.split(":").map(Number);
  const out: { start: string; end: string }[] = [];
  const iso = (ms: number) => {
    const off = zoneOffset(o.zone, ms), local = new Date(ms + off * 60000).toISOString().slice(0, 19);
    const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
    return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  };
  const startLocal = new Date(o.from + zoneOffset(o.zone, o.from) * 60000);
  for (let i = 0; i < 62 && out.length < o.max; i++) {
    const day = new Date(Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth(), startLocal.getUTCDate() + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (o.weekdaysOnly && (day.getUTCDay() === 0 || day.getUTCDay() === 6)) continue;
    let s = Math.max(wallToUtc(o.zone, y, m, d, sh, sm), o.from);
    const e = Math.min(wallToUtc(o.zone, y, m, d, eh, em), o.to);
    if (wallToUtc(o.zone, y, m, d, 0, 0) >= o.to) break;
    // round the start up to the next 15 minutes
    s = Math.ceil(s / 900000) * 900000;
    for (const b of merged) {
      if (b.end <= s || b.start >= e) continue;
      if (b.start - s >= o.minutes * 60000) out.push({ start: iso(s), end: iso(b.start) });
      s = Math.max(s, Math.ceil(b.end / 900000) * 900000);
      if (out.length >= o.max) break;
    }
    if (out.length < o.max && e - s >= o.minutes * 60000) out.push({ start: iso(s), end: iso(e) });
  }
  return out.slice(0, o.max);
}

// ------------------------------------------------------------------ tools

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const CALENDAR_TOOLS: GTool[] = [
  { need: NEED.calList, ...tool({
    name: "calendar_list_calendars",
    description: "List the user's calendars (primary, others they own, shared and subscribed) with ids, access role and time zone.",
    input: z.object({}),
    async execute(_a, ctx) {
      const j = await gcall<{ items?: Record<string, unknown>[] }>(ctx, `${CAL}/users/me/calendarList?maxResults=250`);
      return (j.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: !!c.primary, access: c.accessRole, time_zone: c.timeZone }));
    },
  }) },
  { need: NEED.calRead, ...tool({
    name: "calendar_list_events",
    description: "List events on a calendar (primary by default) between two times, optionally matching text. Recurring events are expanded into single instances.",
    input: z.object({
      calendar_id: calendarId, time_min: z.string().datetime({ offset: true }).optional(), time_max: z.string().datetime({ offset: true }).optional(),
      query: z.string().max(200).optional().describe("Free text to match (title, description, location, guests)"), max: z.number().int().min(1).max(100).default(10),
    }),
    async execute(a, ctx) {
      const j = await gcall<{ items?: Event[] }>(ctx, `${evUrl(a.calendar_id)}${qs({ singleEvents: "true", orderBy: "startTime", maxResults: a.max, timeMin: a.time_min ?? new Date().toISOString(), timeMax: a.time_max, q: a.query })}`);
      return (j.items ?? []).map(brief);
    },
  }) },
  { need: NEED.calRead, ...tool({
    name: "calendar_get_event",
    description: "Get one event in full: time, place, description, organizer, guests and their RSVP, Meet link, recurrence.",
    input: z.object({ calendar_id: calendarId, event_id: eventId }),
    async execute(a, ctx) {
      const e = await gcall<Event>(ctx, evUrl(a.calendar_id, a.event_id));
      return {
        ...brief(e), description: e.description ? clip(str(e.description), 4000) : undefined, organizer: e.organizer?.email, link: e.htmlLink,
        recurrence: e.recurrence, attendees: (e.attendees ?? []).map((x) => ({ email: x.email, name: x.displayName, response: x.responseStatus, ...(x.self ? { you: true } : {}), ...(x.organizer ? { organizer: true } : {}), ...(x.optional ? { optional: true } : {}) })),
      };
    },
  }) },
  { need: NEED.calEvents, ...tool({
    name: "calendar_create_event",
    description: "Create an event (requires the user's approval). Supports all-day dates, guests (they get invites), recurring events (RFC 5545 RRULE lines), a Google Meet link and another calendar.",
    input: z.object({
      title: z.string().min(1).max(200), start: when, end: when,
      location: z.string().max(300).optional(), details: z.string().max(4000).optional(),
      calendar_id: calendarId.optional(), attendees: addressList(100).optional().describe("Guest emails, comma separated (they get an invitation)"),
      time_zone: tz.optional().describe("IANA zone, e.g. Asia/Kolkata (used for recurring events; defaults to the calendar's)"),
      recurrence: rrule.optional().describe("e.g. [\"RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10\"]"), add_meet: z.boolean().optional().describe("Add a Google Meet video link"),
    }),
    requiresApproval: true,
    summarize: (a) => {
      const g = (parseAddresses(a.attendees, 100) ?? []).length;
      return `Add “${a.title}” to your Google Calendar${a.recurrence?.length ? " (repeating)" : ""}${g ? ` and invite ${g} guest${g > 1 ? "s" : ""}` : ""}${a.add_meet ? " with a Meet link" : ""}`;
    },
    async execute(a, ctx) {
      return createEvent(ctx.token, a as NewEvent, ctx.fetch);
    },
  }) },
  { need: NEED.calEvents, ...tool({
    name: "calendar_quick_add",
    description: "Create an event from one natural-language line, the way Google Calendar's quick add does (e.g. \"Dinner with Asha tomorrow 8pm at Olive\"). Requires the user's approval.",
    input: z.object({ text: z.string().min(3).max(300), calendar_id: calendarId }),
    requiresApproval: true,
    summarize: (a) => `Quick-add to your Google Calendar: “${oneLine(a.text).slice(0, 150)}”`,
    async execute(a, ctx) {
      const e = await gcall<Event>(ctx, `${evUrl(a.calendar_id)}/quickAdd${qs({ text: oneLine(a.text) })}`, { method: "POST" });
      return { eventId: e.id, title: e.summary, start: e.start, end: e.end, link: e.htmlLink };
    },
  }) },
  { need: NEED.calEvents, ...tool({
    name: "calendar_update_event",
    description:
      "Edit or move an event: title, start/end (to reschedule), place, description, add/remove guests, add a Meet link, change recurrence. whole_series: true edits every occurrence of a repeating event. " +
      "If the event has other guests, pass has_other_guests: true (the user approves on a card and guests get an update); adding/removing guests also needs approval. Without other guests it runs right away.",
    input: z.object({
      calendar_id: calendarId, event_id: eventId,
      title: z.string().min(1).max(200).optional(), start: when.optional(), end: when.optional(), location: z.string().max(300).optional(), details: z.string().max(4000).optional(),
      add_attendees: addressList(50).optional(), remove_attendees: addressList(50).optional(), add_meet: z.boolean().optional(), recurrence: rrule.optional(),
      time_zone: tz.optional(), whole_series: z.boolean().default(false), has_other_guests: z.boolean().optional().describe("Set true when the event has other guests"),
    }),
    requiresApproval: (a) => !!a.has_other_guests || !!a.add_attendees || !!a.remove_attendees,
    summarize: (a) => `Update a Google Calendar event${a.start ? " (new time)" : ""}`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const e = await loadEvent(ctx, a.calendar_id, a.event_id, a.whole_series);
      const g = guestsOf(e);
      const changes = [a.title && `Title → ${a.title}`, a.start && `Starts → ${a.start}`, a.end && `Ends → ${a.end}`, a.location !== undefined && `Place → ${a.location || "(none)"}`, a.details !== undefined && "New description", a.add_attendees && `Invite ${a.add_attendees}`, a.remove_attendees && `Remove ${a.remove_attendees}`, a.add_meet && "Add a Meet link", a.recurrence && `Repeat → ${a.recurrence.join("; ")}`].filter(Boolean).join("\n");
      return {
        summary: `Update “${oneLine(str(e.summary)).slice(0, 100)}”${a.whole_series ? " (all occurrences)" : ""}`,
        details: { Event: str(e.summary), When: fmtWhen(e), Changes: changes || "(no changes)", ...(g.length ? { Guests: g.map((x) => x.email).join(", ") } : {}) },
        ...(g.length || a.add_attendees || a.remove_attendees ? { warning: "Guests get an email about this change." } : {}),
      };
    },
    async execute(a, ctx) {
      const e = await loadEvent(ctx, a.calendar_id, a.event_id, a.whole_series);
      requireGuestsAck(e, a.has_other_guests, "change");
      const patch: Record<string, unknown> = {};
      if (a.title) patch.summary = a.title;
      if (a.location !== undefined) patch.location = a.location;
      if (a.details !== undefined) patch.description = a.details;
      const zone = a.time_zone ?? e.start?.timeZone;
      if (a.start) patch.start = time(a.start, DATE.test(a.start) ? undefined : zone);
      if (a.end) patch.end = time(a.end, DATE.test(a.end) ? undefined : zone);
      if (a.start && !a.end) {
        // keep the duration when only the start moves
        const s0 = Date.parse(e.start?.dateTime ?? e.start?.date ?? ""), e0 = Date.parse(e.end?.dateTime ?? e.end?.date ?? "");
        if (!isNaN(s0) && !isNaN(e0) && isDateTime(a.start)) patch.end = { dateTime: new Date(Date.parse(a.start) + (e0 - s0)).toISOString(), ...(zone ? { timeZone: zone } : {}) };
      }
      if (a.recurrence) patch.recurrence = a.recurrence;
      const add = parseAddresses(a.add_attendees, 50) ?? [], remove = new Set(parseAddresses(a.remove_attendees, 50) ?? []);
      if (add.length || remove.size) {
        const list = (e.attendees ?? []).filter((x) => !remove.has(str(x.email).toLowerCase()));
        for (const email of add) if (!list.some((x) => str(x.email).toLowerCase() === email)) list.push({ email });
        patch.attendees = list;
      }
      if (a.add_meet && !meetOf(e)) patch.conferenceData = meetRequest();
      const notify = guestsOf(e).length > 0 || add.length > 0 || remove.size > 0;
      const r = await gcall<Event>(ctx, `${evUrl(a.calendar_id, str(e.id))}${qs({ sendUpdates: notify ? "all" : "none", conferenceDataVersion: a.add_meet ? 1 : undefined })}`, { method: "PATCH", body: { json: patch } });
      return { updated: true, ...brief(r), link: r.htmlLink };
    },
  }) },
  { need: NEED.calEvents, ...tool({
    name: "calendar_delete_event",
    description: "Delete an event (whole_series: true deletes every occurrence of a repeating event). If it has other guests, pass has_other_guests: true: the user approves on a card and guests are told it's cancelled. Without other guests it is deleted right away.",
    input: z.object({ calendar_id: calendarId, event_id: eventId, whole_series: z.boolean().default(false), has_other_guests: z.boolean().optional(), notify_guests: z.boolean().default(true) }),
    requiresApproval: (a) => !!a.has_other_guests,
    summarize: () => "Delete a Google Calendar event",
    async prepare(a, ctx): Promise<ToolPreview> {
      const e = await loadEvent(ctx, a.calendar_id, a.event_id, a.whole_series);
      const g = guestsOf(e);
      return {
        summary: `Delete “${oneLine(str(e.summary)).slice(0, 100)}”${a.whole_series && e.recurrence ? " (all occurrences)" : ""}`,
        details: { Event: str(e.summary), When: fmtWhen(e), ...(g.length ? { Guests: g.map((x) => x.email).join(", ") } : {}) },
        warning: g.length && a.notify_guests ? "Guests get a cancellation email." : "The event is removed from the calendar.",
      };
    },
    async execute(a, ctx) {
      const e = await loadEvent(ctx, a.calendar_id, a.event_id, a.whole_series);
      requireGuestsAck(e, a.has_other_guests, "delete");
      await gcall(ctx, `${evUrl(a.calendar_id, str(e.id))}${qs({ sendUpdates: guestsOf(e).length && a.notify_guests ? "all" : "none" })}`, { method: "DELETE" });
      return { deleted: true, title: e.summary };
    },
  }) },
  { need: NEED.calEvents, ...tool({
    name: "calendar_rsvp",
    description: "Answer an invitation: accepted, declined or tentative (maybe), with an optional note to the organizer. Needs the user's approval because the organizer is notified.",
    input: z.object({ calendar_id: calendarId, event_id: eventId, response: z.enum(["accepted", "declined", "tentative"]), comment: z.string().max(500).optional() }),
    requiresApproval: true,
    summarize: (a) => `RSVP “${a.response === "accepted" ? "Yes" : a.response === "declined" ? "No" : "Maybe"}” to an invitation`,
    async prepare(a, ctx): Promise<ToolPreview> {
      const e = await gcall<Event>(ctx, evUrl(a.calendar_id, a.event_id));
      if (!(e.attendees ?? []).some((x) => x.self)) throw new ConnectorError("You aren't a guest on this event, so there's nothing to RSVP.", 400, "invalid");
      const ans = a.response === "accepted" ? "Yes" : a.response === "declined" ? "No" : "Maybe";
      return { summary: `RSVP “${ans}” to “${oneLine(str(e.summary)).slice(0, 100)}”`, details: { Event: str(e.summary), When: fmtWhen(e), Organizer: str(e.organizer?.email), "Your answer": ans, ...(a.comment ? { Note: a.comment } : {}) } };
    },
    async execute(a, ctx) {
      const e = await gcall<Event>(ctx, evUrl(a.calendar_id, a.event_id));
      const list = e.attendees ?? [];
      const me = list.find((x) => x.self);
      if (!me) throw new ConnectorError("You aren't a guest on this event, so there's nothing to RSVP.", 400, "invalid");
      me.responseStatus = a.response;
      if (a.comment) (me as Record<string, unknown>).comment = a.comment;
      await gcall(ctx, `${evUrl(a.calendar_id, a.event_id)}?sendUpdates=all`, { method: "PATCH", body: { json: { attendees: list } } });
      return { answered: a.response, title: e.summary };
    },
  }) },
  { need: NEED.calFree, ...tool({
    name: "calendar_find_free_time",
    description: "Find free slots of a given length in the user's calendar (and optionally other people's, if their calendars are visible) within working hours between two times.",
    input: z.object({
      time_min: z.string().datetime({ offset: true }), time_max: z.string().datetime({ offset: true }),
      duration_minutes: z.number().int().min(5).max(600).default(30),
      attendees: addressList(20).optional().describe("Other people's emails to find a common free slot"),
      calendar_ids: z.array(z.string().regex(/^[A-Za-z0-9._%+@#-]{1,250}$/)).max(10).optional(),
      time_zone: tz.default("Asia/Kolkata"), day_start: hhmm.default("09:00"), day_end: hhmm.default("18:00"),
      weekdays_only: z.boolean().default(false), max_slots: z.number().int().min(1).max(30).default(10),
    }),
    async execute(a, ctx) {
      const from = Date.parse(a.time_min), to = Date.parse(a.time_max);
      if (!(to > from)) throw new ConnectorError("time_max must be after time_min.", 400, "invalid");
      if (to - from > 62 * 86400000) throw new ConnectorError("Look at most 62 days ahead at a time.", 400, "invalid");
      const items = [...(a.calendar_ids?.length ? a.calendar_ids : ["primary"]), ...(parseAddresses(a.attendees, 20) ?? [])].map((id) => ({ id }));
      const j = await gcall<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(ctx, `${CAL}/freeBusy`, { method: "POST", body: { json: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), timeZone: a.time_zone, items } } });
      const busy: Busy[] = [], unavailable: string[] = [];
      for (const [id, c] of Object.entries(j.calendars ?? {})) {
        if (c.errors?.length) { unavailable.push(id); continue; }
        for (const b of c.busy ?? []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
      }
      const slots = freeSlots(busy, { from, to, minutes: a.duration_minutes, zone: a.time_zone, dayStart: a.day_start, dayEnd: a.day_end, weekdaysOnly: a.weekdays_only, max: a.max_slots });
      return { time_zone: a.time_zone, slots, ...(unavailable.length ? { not_visible: unavailable, note: "These calendars aren't visible to the user, so their busy times aren't included." } : {}) };
    },
  }) },
];
