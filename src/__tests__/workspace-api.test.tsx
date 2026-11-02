// Server-side authorization, task lifecycle and approval enforcement, exercised through the real route handlers.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./helpers/fakeSupabase";

let db = new FakeDb();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => db }));

import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as approvalRoute from "@/app/api/approvals/[id]/route";
import * as executeRoute from "@/app/api/approvals/[id]/execute/route";
import * as approvalsRoute from "@/app/api/approvals/route";
import * as activityRoute from "@/app/api/activity/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as panelRoute from "@/app/api/panels/[id]/route";
import * as memoryRoute from "@/app/api/memories/[id]/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as connectorsRoute from "@/app/api/connectors/route";
import * as convRoute from "@/app/api/conversations/[id]/route";
import { decideApproval, executeApproval, proposeAction } from "@/lib/server/approvals";
import type { Db } from "@/lib/server/auth";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";
const AP = "55555555-5555-4555-8555-555555555555";
const PN = "66666666-6666-4666-8666-666666666666";
const M = "77777777-7777-4777-8777-777777777777";
const C = "88888888-8888-4888-8888-888888888888";

const req = (body?: unknown, url = "http://t/x") => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seed() {
  db = new FakeDb({
    projects: [{ id: P, user_id: A, name: "Goa trip", instructions: "", description: "", status: "active" }],
    tasks: [{ id: T, user_id: A, title: "Book hotel", notes: "", status: "queued", progress: "", error: null, origin: "user", project_id: P, conversation_id: null }],
    approval_requests: [{ id: AP, user_id: A, action_type: "create_task", summary: "Add the task “Pack bags”", destination: "TARGET · Tasks", payload: { title: "Pack bags", notes: "" }, status: "pending", decided_by: null, project_id: P, task_id: null, conversation_id: null }],
    panels: [{ id: PN, user_id: A, kind: "list", title: "Packing", config: {}, items: [] }],
    memories: [{ id: M, user_id: A, content: "Likes tea", source: "chat" }],
    conversations: [{ id: C, user_id: A, title: "Hotels", project_id: P }],
  });
}
beforeEach(seed);

describe("authorization boundaries", () => {
  it("rejects every endpoint without a session (401)", async () => {
    db.as(null);
    const results = await Promise.all([
      tasksRoute.GET(new Request("http://t/api/tasks")), tasksRoute.POST(req({ title: "x" })),
      taskRoute.PATCH(req({ status: "completed" }), ctx(T)), approvalRoute.POST(req({ decision: "approve" }), ctx(AP)),
      executeRoute.POST(req(), ctx(AP)), approvalsRoute.GET(new Request("http://t/api/approvals")),
      activityRoute.GET(new Request("http://t/api/activity")), projectsRoute.GET(new Request("http://t/api/projects")),
      panelRoute.PATCH(req({ title: "x" }), ctx(PN)), memoryRoute.PATCH(req({ content: "x y" }), ctx(M)),
      settingsRoute.PATCH(req({ memory_enabled: false })), connectorsRoute.GET(), convRoute.DELETE(req(), ctx(C)),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(401));
    expect(db.rows("approval_requests")[0].status).toBe("pending");
  });

  it("another user can't read, change or delete someone else's data (404, nothing changes)", async () => {
    db.as(B);
    expect((await taskRoute.PATCH(req({ status: "completed" }), ctx(T))).status).toBe(404);
    expect((await taskRoute.DELETE(req(), ctx(T))).status).toBe(404);
    expect((await projectRoute.PATCH(req({ name: "Mine now" }), ctx(P))).status).toBe(404);
    expect((await projectRoute.DELETE(req(), ctx(P))).status).toBe(404);
    expect((await panelRoute.PATCH(req({ items: [{ text: "x" }] }), ctx(PN))).status).toBe(404);
    expect((await memoryRoute.DELETE(req(), ctx(M))).status).toBe(404);
    expect((await convRoute.DELETE(req(), ctx(C))).status).toBe(404);
    expect((await approvalRoute.GET(req(), ctx(AP))).status).toBe(404);
    expect((await approvalRoute.POST(req({ decision: "approve" }), ctx(AP))).status).toBe(404);
    expect((await executeRoute.POST(req(), ctx(AP))).status).toBe(404);
    const list = await (await tasksRoute.GET(new Request("http://t/api/tasks"))).json();
    expect(list.tasks).toEqual([]);
    expect(db.rows("tasks")[0].status).toBe("queued");
    expect(db.rows("projects")[0].name).toBe("Goa trip");
    expect(db.rows("approval_requests")[0].status).toBe("pending");
    expect(db.rows("memories")).toHaveLength(1);
  });

  it("can't attach a task to someone else's project", async () => {
    db.as(B);
    const r = await tasksRoute.POST(req({ title: "Sneaky", project_id: P }));
    expect(r.status).toBe(404);
    expect(db.rows("tasks")).toHaveLength(1);
  });

  it("rejects malformed ids and input", async () => {
    db.as(A);
    expect((await taskRoute.PATCH(req({ status: "completed" }), ctx("not-a-uuid"))).status).toBe(404);
    const bad = await tasksRoute.POST(req({ title: "   " }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe("title");
    expect((await settingsRoute.PATCH(req({ memory_enabled: "yes" }))).status).toBe(400);
    expect((await activityRoute.DELETE(new Request("http://t", { method: "DELETE", body: "{}" }))).status).toBe(400);
  });
});

describe("task lifecycle", () => {
  it("creates queued tasks, moves them along allowed paths and records activity", async () => {
    db.as(A);
    const created = await tasksRoute.POST(req({ title: "Compare flights", project_id: P }));
    expect(created.status).toBe(201);
    const { task } = await created.json();
    expect(task.status).toBe("queued");
    const done = await taskRoute.PATCH(req({ status: "completed" }), ctx(task.id));
    expect(done.status).toBe(200);
    expect((await done.json()).task.status).toBe("completed");
    const cats = db.rows("activity_events").map((e) => [e.category, e.status]);
    expect(cats).toEqual([["task", "queued"], ["outcome", "completed"]]);
  });

  it("refuses system-only statuses and invalid transitions", async () => {
    db.as(A);
    expect((await taskRoute.PATCH(req({ status: "waiting_approval" }), ctx(T))).status).toBe(400);
    await taskRoute.PATCH(req({ status: "completed" }), ctx(T));
    const r = await taskRoute.PATCH(req({ status: "in_progress" }), ctx(T));
    expect(r.status).toBe(409);
    expect((await taskRoute.PATCH(req({ status: "queued" }), ctx(T))).status).toBe(200); // reopen
  });
});

describe("approval enforcement", () => {
  it("nothing runs until the owner approves; approving runs it exactly once and records the outcome", async () => {
    db.as(A);
    const exec = vi.fn().mockResolvedValue({ ok: 1 });
    const early = await executeApproval(db as unknown as Db, A, AP, { create_task: exec });
    expect(early.status).toBe(409);
    expect(exec).not.toHaveBeenCalled();

    const r = await approvalRoute.POST(req({ decision: "approve" }), ctx(AP));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.approval.status).toBe("executed");
    expect(db.rows("tasks").some((t) => t.title === "Pack bags" && t.project_id === P)).toBe(true);
    const titles = db.rows("activity_events").map((e) => `${e.category}:${e.status}`);
    expect(titles).toEqual(["approval:approved", "outcome:executed"]);

    const again = await approvalRoute.POST(req({ decision: "approve" }), ctx(AP));
    expect(again.status).toBe(409);
    expect((await executeRoute.POST(req(), ctx(AP))).status).toBe(409);
    expect(db.rows("tasks").filter((t) => t.title === "Pack bags")).toHaveLength(1);
  });

  it("rejecting records the decision and never executes", async () => {
    db.as(A);
    const exec = vi.fn();
    const r = await decideApproval(db as unknown as Db, A, AP, "reject", { create_task: exec });
    expect(r.status).toBe(200);
    expect(db.rows("approval_requests")[0].status).toBe("rejected");
    expect(exec).not.toHaveBeenCalled();
    expect((await executeRoute.POST(req(), ctx(AP))).status).toBe(409);
    expect(db.rows("activity_events")[0].title).toMatch(/^Rejected/);
  });

  it("refuses execution of an action approved by a different user", async () => {
    db.rows("approval_requests")[0].status = "approved";
    db.rows("approval_requests")[0].decided_by = B;
    db.as(A);
    const exec = vi.fn();
    const r = await executeApproval(db as unknown as Db, A, AP, { create_task: exec });
    expect(r.status).toBe(403);
    expect(exec).not.toHaveBeenCalled();
  });

  it("a failed action is recorded as failed and can be re-approved", async () => {
    db.as(A);
    const boom = vi.fn().mockRejectedValue(new Error("Provider down"));
    const r = await decideApproval(db as unknown as Db, A, AP, "approve", { create_task: boom });
    expect(r.status).toBe(502);
    expect(db.rows("approval_requests")[0]).toMatchObject({ status: "failed", error: "Provider down" });
    expect(db.rows("activity_events").at(-1)).toMatchObject({ category: "outcome", status: "failed" });
    const ok = vi.fn().mockResolvedValue({});
    const retry = await decideApproval(db as unknown as Db, A, AP, "approve", { create_task: ok });
    expect(retry.status).toBe(200);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("the database refuses pre-approved inserts and rewriting an approval's payload", async () => {
    db.as(A);
    const ins = await db.from("approval_requests").insert({ user_id: A, action_type: "create_task", summary: "x", payload: {}, status: "approved" });
    expect(ins.error).not.toBeNull();
    const upd = await db.from("approval_requests").update({ payload: { title: "something else" } }).eq("id", AP);
    expect(upd.error).not.toBeNull();
    const skip = await db.from("approval_requests").update({ status: "executed" }).eq("id", AP);
    expect(skip.error?.message).toMatch(/invalid transition/);
  });

  it("only offers approval for actions that can actually run", async () => {
    db.as(A);
    const cal = await proposeAction(db as unknown as Db, A, { action: "calendar_event", params: { title: "x", start: new Date().toISOString(), end: new Date(Date.now() + 1).toISOString() }, summary: "s", destination: "d" }, { projectId: null, conversationId: null, connected: new Set() });
    expect(cal.ok).toBe(false);
    const mail = await proposeAction(db as unknown as Db, A, { action: "send_email", params: {}, summary: "s", destination: "d" }, { projectId: null, conversationId: null, connected: new Set(["gmail"]) });
    expect(mail.ok).toBe(false);
    expect(db.rows("approval_requests")).toHaveLength(1);
    const task = await proposeAction(db as unknown as Db, A, { action: "create_task", params: { title: "Call mom", notes: "" }, summary: "Add the task “Call mom”", destination: "TARGET · Tasks" }, { projectId: P, conversationId: C, connected: new Set() });
    expect(task.ok).toBe(true);
    expect(db.rows("approval_requests").at(-1)).toMatchObject({ status: "pending", user_id: A });
  });

  it("there is no client endpoint for creating approvals", () => {
    expect((approvalsRoute as Record<string, unknown>).POST).toBeUndefined();
  });
});

describe("settings, panels and connectors endpoints", () => {
  it("saves memory toggle and validates quick actions", async () => {
    db.as(A);
    const r = await settingsRoute.PATCH(req({ memory_enabled: false }));
    expect((await r.json()).settings.memory_enabled).toBe(false);
    expect((await settingsRoute.PATCH(req({ quick_actions: [{ label: "", prompt: "x" }] }))).status).toBe(400);
  });

  it("panel items are schema-validated server-side", async () => {
    db.as(A);
    expect((await panelRoute.PATCH(req({ items: [{ text: "" }] }), ctx(PN))).status).toBe(400);
    expect((await panelRoute.PATCH(req({ items: "<script>" }), ctx(PN))).status).toBe(400);
    const ok = await panelRoute.PATCH(req({ items: [{ text: "Passport", done: true, evil: "x" }] }), ctx(PN));
    const j = await ok.json();
    expect(j.panel.items[0]).toEqual({ id: expect.any(String), text: "Passport", done: true });
  });

  it("never reports an app as connected without a stored connection, and flags missing setup", async () => {
    db.as(A);
    const j = await (await connectorsRoute.GET()).json();
    const g = j.connectors.find((i: { id: string }) => i.id === "google");
    expect(g.status).toBe("setup_required");
    expect(j.connectors.some((i: { status: string }) => i.status === "connected")).toBe(false);
  });
});
