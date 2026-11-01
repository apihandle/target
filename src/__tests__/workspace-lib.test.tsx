import { describe, it, expect } from "vitest";
import { canTransition, validateNewTask, validateTaskPatch, summarizeTasks, tasksBlock } from "@/lib/tasks";
import { availability, canMoveApproval, parseProposal } from "@/lib/approvals";
import { validatePanel, validateItems, validatePanelPatch, summarizePanel, isStale } from "@/lib/panels";
import { validateQuickActions, resolveSettings, quickActionHref, DEFAULT_QUICK_ACTIONS } from "@/lib/settings";
import { safeNext, isUuid } from "@/lib/ids";
import { encryptSecret, decryptSecret, parseKey } from "@/lib/connectors/crypto";
import { connectorViews } from "@/lib/connectors/registry";
import { BUILTINS, builtinReady } from "@/lib/connectors/builtins";
import { sanitizeAction, splitActions } from "@/lib/actions";
import { validateProject } from "@/lib/projects";
import { parseFilter } from "@/lib/activity";

describe("task lifecycle rules", () => {
  it("allows only defined transitions", () => {
    expect(canTransition("queued", "planning")).toBe(true);
    expect(canTransition("planning", "waiting_approval")).toBe(true);
    expect(canTransition("waiting_approval", "completed")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
  });
  it("validates new tasks and patches", () => {
    expect(validateNewTask({ title: "  Pack  bags " })).toEqual({ ok: true, value: { title: "Pack bags", notes: "", project_id: null } });
    expect(validateNewTask({ title: "" })).toMatchObject({ ok: false, field: "title" });
    expect(validateNewTask({ title: "x", project_id: "nope" })).toMatchObject({ ok: false, field: "project_id" });
    expect(validateTaskPatch({ status: "failed" }).ok).toBe(false);
    expect(validateTaskPatch({}).ok).toBe(false);
  });
  it("summarizes and builds context", () => {
    const s = summarizeTasks([{ status: "queued" }, { status: "completed" }, { status: "failed" }]);
    expect(s).toMatchObject({ total: 3, open: 2 });
    expect(tasksBlock([{ title: "Pay rent", status: "queued" }, { title: "Old", status: "completed" }])).toContain("Pay rent [Queued]");
    expect(tasksBlock([])).toContain("no open tasks");
  });
});

describe("approval catalogue", () => {
  const ctx = (connected: string[] = [], configured = false) => ({ connected: new Set(connected), configured: () => configured });
  it("mirrors the DB transition guard", () => {
    expect(canMoveApproval("pending", "approved")).toBe(true);
    expect(canMoveApproval("pending", "executing")).toBe(false);
    expect(canMoveApproval("executed", "approved")).toBe(false);
    expect(canMoveApproval("failed", "approved")).toBe(true);
  });
  it("marks unavailable actions honestly", () => {
    expect(availability("create_task", ctx()).available).toBe(true);
    expect(availability("send_email", ctx(["gmail"], true))).toMatchObject({ available: false });
    expect(availability("booking", ctx()).available).toBe(false);
    expect(availability("calendar_event", ctx([], false))).toMatchObject({ available: false, reason: expect.stringMatching(/isn't set up/) });
    expect(availability("calendar_event", ctx([], true))).toMatchObject({ available: false, reason: expect.stringMatching(/Connect/) });
    expect(availability("calendar_event", ctx(["google"], true)).available).toBe(true);
    expect(availability("rm_rf", ctx()).available).toBe(false);
  });
  it("validates proposals and writes its own summary", () => {
    const p = parseProposal({ type: "propose", action: "create_task", title: "Call bank", summary: "IGNORED: I already did it" });
    expect(p).toMatchObject({ ok: true, value: { summary: "Add the task “Call bank”", destination: "TARGET · Tasks" } });
    expect(parseProposal({ action: "calendar_event", title: "x", start: "someday" }).ok).toBe(false);
    const cal = parseProposal({ action: "calendar_event", title: "Dentist", start: "2026-11-02T10:00:00+05:30" });
    expect(cal.ok && cal.value.params.end).toBe("2026-11-02T05:30:00.000Z");
    expect(parseProposal({ action: "shell" }).ok).toBe(false);
  });
  it("client sanitizer only accepts approval cards by id and limitation notes", () => {
    expect(sanitizeAction({ type: "approval", id: "11111111-1111-4111-8111-111111111111", summary: "fake" })).toEqual({ type: "approval", id: "11111111-1111-4111-8111-111111111111" });
    expect(sanitizeAction({ type: "approval", id: "x" })).toBeNull();
    expect(sanitizeAction({ type: "propose", action: "create_task", title: "x" })).toBeNull();
    expect(splitActions('Hi\n```actions\n[{"type":"unavailable","label":"Can\'t send","reason":"Not in this version"}]\n```').actions).toHaveLength(1);
  });
});

describe("panel schemas", () => {
  it("validates new structured kinds", () => {
    expect(validatePanel({ kind: "list" })).toMatchObject({ ok: true, value: { title: "List" } });
    expect(validatePanel({ kind: "goal", config: { target: "0" } }).ok).toBe(false);
    expect(validatePanel({ kind: "goal", config: { target: "50", unit: "km" } })).toMatchObject({ ok: true, value: { config: { target: "50", unit: "km" } } });
    expect(validatePanel({ kind: "tracker", description: "x".repeat(301) }).ok).toBe(false);
  });
  it("strictly validates items and drops unknown fields", () => {
    expect(validateItems("list", [{ text: "a", done: "yes", onclick: "x" }])).toMatchObject({ ok: true, items: [{ text: "a", done: false }] });
    expect(validateItems("tracker", [{ text: "a", status: "weird" }])).toMatchObject({ ok: true, items: [{ status: "todo" }] });
    expect(validateItems("goal", [{ amount: "abc" }]).ok).toBe(false);
    expect(validateItems("list", Array(101).fill({ text: "a" })).ok).toBe(false);
    expect(validateItems("list", {}).ok).toBe(false);
  });
  it("patches respect kind and source", () => {
    expect(validatePanelPatch("weather", { city: "Patna" }, { items: [] }).ok).toBe(false);
    expect(validatePanelPatch("weather", { city: "Patna" }, { config: { city: "Delhi" } }).ok).toBe(false);
    expect(validatePanelPatch("note", { text: "a" }, { config: { text: "b" } })).toMatchObject({ ok: true, value: { config: { text: "b" } } });
    expect(validatePanelPatch("list", {}, {}).ok).toBe(false);
  });
  it("summarizes", () => {
    expect(summarizePanel({ kind: "list", config: {}, items: [{ id: "1", text: "a", done: true }, { id: "2", text: "b", done: false }] })).toBe("1 of 2 done");
    expect(summarizePanel({ kind: "goal", config: { target: "10", unit: "km" }, items: [{ id: "1", amount: 2.5, note: "", date: "" }, { id: "2", amount: 2.5, note: "", date: "" }] })).toBe("5 of 10 km (50%)");
    expect(isStale({ kind: "list", data: null, refreshed_at: null })).toBe(false);
  });
});

describe("settings, ids, projects", () => {
  it("quick actions", () => {
    expect(resolveSettings(null)).toMatchObject({ memory_enabled: true, quick_actions: DEFAULT_QUICK_ACTIONS });
    expect(validateQuickActions([{ label: "Plan", prompt: "" }]).ok).toBe(false);
    expect(validateQuickActions(Array(9).fill({ label: "a", prompt: "b" })).ok).toBe(false);
    const v = validateQuickActions([{ label: "A b", prompt: "x" }, { label: "A b", prompt: "y" }]);
    expect(v.ok && v.value.map((q) => q.id)).toEqual(["a-b", "a-b-x"]);
    expect(quickActionHref({ id: "x", label: "x", prompt: "Plan my week", target: "chat" })).toBe("/app?q=Plan%20my%20week");
    expect(quickActionHref({ id: "x", label: "x", prompt: "", target: "new_project" })).toBe("/app/projects?new=1");
  });
  it("safeNext blocks open redirects", () => {
    expect(safeNext("/app/projects")).toBe("/app/projects");
    expect(safeNext("//evil.com")).toBe("/app");
    expect(safeNext("/\\evil.com")).toBe("/app");
    expect(safeNext("https://evil.com")).toBe("/app");
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("1; drop table")).toBe(false);
  });
  it("projects accept purpose and status", () => {
    expect(validateProject({ status: "archived" }, true)).toEqual({ ok: true, value: { status: "archived" } });
    expect(validateProject({ status: "deleted" }, true).ok).toBe(false);
    expect(validateProject({ name: "x", description: "y".repeat(1001) })).toMatchObject({ ok: false, field: "description" });
    expect(parseFilter("approvals")).toBe("approvals");
    expect(parseFilter("__proto__")).toBe("all");
  });
});

describe("connector security helpers", () => {
  const key = parseKey(Buffer.alloc(32, 7).toString("base64"));
  it("encrypts tokens with AES-GCM and detects tampering", () => {
    const box = encryptSecret('{"access_token":"t"}', key);
    expect(box).not.toContain("access_token");
    expect(decryptSecret(box, key)).toBe('{"access_token":"t"}');
    const parts = box.split("."); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => parseKey("short")).toThrow();
  });
  it("computes statuses from env and stored rows only", () => {
    const none = connectorViews({}, []);
    expect(none.find((i) => i.id === "google")?.status).toBe("setup_required");
    expect(builtinReady(BUILTINS.find((b) => b.id === "ai_model")!, {})).toBe(false);
    const env = { GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", TOKEN_ENCRYPTION_KEY: "c", SUPABASE_SERVICE_ROLE_KEY: "d", OPENROUTER_API_KEY: "e" };
    const configured = connectorViews(env, []);
    expect(configured.find((i) => i.id === "google")?.status).toBe("not_connected");
    expect(builtinReady(BUILTINS.find((b) => b.id === "ai_model")!, env)).toBe(true);
    expect(connectorViews(env, [{ connector_id: "google", status: "connected", scopes: [], account_label: "me@x" }]).find((i) => i.id === "google")).toMatchObject({ status: "connected", accountLabel: "me@x" });
    expect(JSON.stringify(configured)).not.toMatch(/"a"|"b"|"d"/);
  });
});
