import { describe, expect, it } from "vitest";
import { isOnline, ONLINE_MS } from "@/lib/server/workerStatus";
import { canSeeSetup, envChecks, MIGRATION_CHECKS, workerCheck } from "@/lib/server/setupCheck";
import { friendlyError, friendlyStatus } from "@/lib/friendlyError";
import { resultText, runInBrowser, runnerHtml, MAX_OUTPUT } from "@/lib/browserCode";

describe("worker heartbeat", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  const beat = (agoMs: number, modes = ["steps", "auto", "code"]) => ({ id: "w", modes, seen_at: new Date(now - agoMs).toISOString() });
  it("is online only when seen recently", () => {
    expect(isOnline([beat(5000)], undefined, now)).toBe(true);
    expect(isOnline([beat(ONLINE_MS + 1000)], undefined, now)).toBe(false);
    expect(isOnline([], undefined, now)).toBe(false);
  });
  it("checks the mode", () => {
    expect(isOnline([beat(1000, ["steps", "auto"])], "code", now)).toBe(false);
    expect(isOnline([beat(1000)], "code", now)).toBe(true);
  });
  it("worker check reports offline with a fix", () => {
    const c = workerCheck([]);
    expect(c.ok).toBe(false);
    expect(c.required).toBe(false);
    expect(c.fix).toMatch(/Hugging Face/);
  });
});

describe("setup check", () => {
  it("reports presence only and never values", () => {
    const checks = envChecks({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", OPENROUTER_API_KEY: "sk-secret-value", CRON_SECRET: "  " });
    const by = (label: string) => checks.find((c) => c.label === label)!;
    expect(by("Database (Supabase)").ok).toBe(true);
    expect(by("AI model").ok).toBe(true);
    expect(by("Reminders and scheduled prompts").ok).toBe(false);
    expect(by("Server database key").ok).toBe(false);
    expect(JSON.stringify(checks)).not.toContain("sk-secret-value");
  });
  it("needs both halves of a pair", () => {
    const vapid = envChecks({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub" }).find((c) => c.label === "Phone notifications")!;
    expect(vapid.ok).toBe(false);
  });
  it("lists every migration from 0006 to 0015", () => {
    expect(MIGRATION_CHECKS.map((m) => m.file.slice(0, 4))).toEqual(["0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015"]);
  });
  it("is owner-only once ADMIN_EMAIL is set", () => {
    expect(canSeeSetup("a@b.com", {})).toBe(true);
    expect(canSeeSetup("Owner@x.com", { ADMIN_EMAIL: "owner@x.com" })).toBe(true);
    expect(canSeeSetup("other@x.com", { ADMIN_EMAIL: "owner@x.com" })).toBe(false);
  });
});

describe("friendly errors", () => {
  it("maps statuses to plain sentences", () => {
    expect(friendlyStatus(429)).toMatch(/wait a minute/i);
    expect(friendlyStatus(504)).toMatch(/too long/i);
    expect(friendlyStatus(500, "Request failed (500)")).toMatch(/TARGET's side/);
    expect(friendlyStatus(400, "Message is empty")).toBe("Message is empty");
    expect(friendlyStatus(500, "TypeError: cannot read undefined at stack")).toMatch(/TARGET's side/);
  });
  it("explains network failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/internet/);
    expect(friendlyError("x".repeat(500))).toMatch(/Something went wrong/);
  });
});

describe("browser code runner", () => {
  it("clips output and notes empty runs", () => {
    expect(resultText({ ok: true, output: "42\n", files: [] })).toBe("42");
    expect(resultText({ ok: true, output: "", files: [] })).toBe("(no output)");
    expect(resultText({ ok: true, output: "", files: [{ name: "a.csv", base64: "eA==" }] })).toMatch(/files were saved/);
    expect(resultText({ ok: true, output: "y".repeat(MAX_OUTPUT + 50), files: [] })).toMatch(/output cut/);
  });
  it("frame program only answers its own nonce and loads Pyodide from the CDN", () => {
    const html = runnerHtml("abc-123");
    expect(html).toContain('"abc-123"');
    expect(html).toContain("cdn.jsdelivr.net/pyodide");
    expect(html).toContain("m.nonce !== NONCE");
  });
  it("runs in a sandboxed frame without same-origin and cleans up on timeout", async () => {
    const p = runInBrowser({ id: "1", goal: "t", language: "python", code: "print(1)", inputs: [] }, 50);
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Stopped/);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
