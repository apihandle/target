import { describe, expect, it } from "vitest";
import { describeSchedule, nextRunAt, validateJob } from "@/lib/schedule";
import { parseProposal } from "@/lib/approvals";

const IST = "Asia/Kolkata";
describe("one-time reminders and every-N-hours", () => {
  it("validates once and interval", () => {
    expect(validateJob({ prompt: "Call bank", cadence: "once", run_on: "2026-11-02", time_of_day: "18:00", timezone: IST })).toMatchObject({ ok: true, value: { run_on: "2026-11-02", interval_hours: null, weekday: null } });
    expect(validateJob({ prompt: "x", cadence: "once", run_on: "2026-02-30", time_of_day: "18:00" })).toMatchObject({ ok: false, field: "run_on" });
    expect(validateJob({ prompt: "x", cadence: "once", time_of_day: "18:00" })).toMatchObject({ ok: false, field: "run_on" });
    expect(validateJob({ prompt: "Water", cadence: "interval", interval_hours: "2", time_of_day: "08:00" })).toMatchObject({ ok: true, value: { interval_hours: 2, run_on: null } });
    expect(validateJob({ prompt: "x", cadence: "interval", interval_hours: 0, time_of_day: "08:00" })).toMatchObject({ ok: false, field: "interval_hours" });
    expect(validateJob({ prompt: "x", cadence: "interval", interval_hours: 200, time_of_day: "08:00" })).toMatchObject({ ok: false, field: "interval_hours" });
  });
  it("computes a once run in the user's timezone, and null after it passed", () => {
    const job = { cadence: "once" as const, run_on: "2026-11-02", time_of_day: "18:00", timezone: IST, weekday: null };
    expect(nextRunAt(job, new Date("2026-11-01T04:00:00Z"))?.toISOString()).toBe("2026-11-02T12:30:00.000Z");
    expect(nextRunAt(job, new Date("2026-11-02T13:00:00Z"))).toBeNull();
  });
  it("steps every N hours from the start time", () => {
    const job = { cadence: "interval" as const, interval_hours: 2, time_of_day: "08:00", timezone: IST, weekday: null };
    // 09:30 IST -> next 10:00 IST
    expect(nextRunAt(job, new Date("2026-11-01T04:00:00Z"))?.toISOString()).toBe("2026-11-01T04:30:00.000Z");
    // 07:00 IST (before start) -> 08:00 IST
    expect(nextRunAt(job, new Date("2026-11-01T01:30:00Z"))?.toISOString()).toBe("2026-11-01T02:30:00.000Z");
    // exactly on a slot -> the following slot
    expect(nextRunAt(job, new Date("2026-11-01T04:30:00Z"))?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
  it("describes the new schedules", () => {
    expect(describeSchedule({ cadence: "once", run_on: "2026-11-02", time_of_day: "18:00", timezone: IST, weekday: null })).toMatch(/^Once on .*2 Nov.*2026 at 6:00 PM/);
    expect(describeSchedule({ cadence: "interval", interval_hours: 3, time_of_day: "08:00", timezone: IST, weekday: null })).toBe("Every 3 hours from 8:00 AM (Asia/Kolkata)");
  });
  it("the AI can propose a reminder for approval", () => {
    const r = parseProposal({ type: "propose", action: "create_schedule", title: "Call bank", prompt: "Remind me to call the bank", cadence: "once", run_on: "2026-11-02", time_of_day: "18:00", timezone: IST });
    expect(r).toMatchObject({ ok: true, value: { params: { cadence: "once", run_on: "2026-11-02" } } });
    if (r.ok) expect(r.value.summary).toMatch(/Once on/);
  });
});
