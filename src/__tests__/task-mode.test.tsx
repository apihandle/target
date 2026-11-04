/**
 * Task mode: approval cards are approved in code and shown as "Done automatically" (logged with auto = true),
 * except payments and deletes, which always wait. The toggle is saved per chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FakeDb } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fakeSupabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin() }));
vi.mock("@/lib/server/kickWorker", () => ({ kickCloudWorker: () => Promise.resolve() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));

import { looksLikeMoney, taskModeCommand, taskModeDecision, TASK_MODE_PROMPT } from "@/lib/taskMode";
import { autoApprove, chatTaskMode } from "@/lib/server/taskMode";
import { PATCH as patchConversation } from "@/app/api/conversations/[id]/route";
import ApprovalCard from "@/components/ApprovalCard";
import Chat from "@/components/Chat";
import type { Db } from "@/lib/server/auth";

const U = "11111111-1111-4111-8111-111111111111";
const CONV = "44444444-4444-4444-8444-444444444444";
const JOB = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  h.db = new FakeDb({ conversations: [{ id: CONV, user_id: U, title: "t", task_mode: false }], approval_requests: [], tasks: [], activity_events: [], scheduled_jobs: [], connections: [], browser_jobs: [], vault_secrets: [], projects: [] });
  h.db.as(U);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const tool = (connector: string, name: string, args: Record<string, unknown> = {}) => ({ action_type: "connector_tool", summary: `${connector} ${name}`, payload: { connector, tool: name, args } });

describe("which cards run automatically", () => {
  it.each([
    ["add a task", { action_type: "create_task", summary: "Add the task “x”", payload: { title: "x" } }],
    ["start a project", { action_type: "create_project", summary: "Create the project “x”", payload: { name: "x" } }],
    ["schedule", { action_type: "create_schedule", summary: "Remind me every Monday", payload: {} }],
    ["calendar event", { action_type: "calendar_event", summary: "Add event", payload: {} }],
    ["create account", { action_type: "site_account", summary: "Create a new account on demo.example.com", payload: { browser_job_id: JOB, flow: "register" } }],
    ["password reset", { action_type: "site_account", summary: "Reset your password on demo.example.com", payload: { browser_job_id: JOB, flow: "reset" } }],
    ["booking with no charge", { action_type: "reservation", summary: "Book a table", payload: { browser_job_id: JOB, price: "", payment: "" } }],
    ["send email", tool("google", "gmail_send", { to: "a@example.com" })],
    ["forward email", tool("google", "gmail_forward")],
    ["share a file", tool("google", "drive_share")],
    ["post to Slack", tool("slack", "send_message")],
    ["post a Figma comment", tool("figma", "post_comment")],
    ["GitHub commit", tool("github", "commit_files")],
    ["GitHub merge", tool("github", "merge_pull_request")],
    ["Vercel deploy", tool("vercel", "create_deployment")],
    ["Vercel rollback", tool("vercel", "rollback_deployment")],
    ["Supabase SQL update", tool("supabase", "run_sql", { query: "update profiles set plan = 'x' where id = 1" })],
    ["Supabase migration", tool("supabase", "apply_migration", { query: "alter table t add column c int" })],
  ])("%s: auto", (_n, a) => expect(taskModeDecision(a)).toEqual({ auto: true }));

  it.each([
    ["order", { action_type: "purchase", summary: "Pay ₹499 at Store", payload: { browser_job_id: JOB, total: "₹499" } }],
    ["paid booking", { action_type: "reservation", summary: "Book a table", payload: { browser_job_id: JOB, price: "₹1,200" } }],
    ["booking paid by card", { action_type: "reservation", summary: "Book", payload: { browser_job_id: JOB, price: "", payment: "Card from your vault" } }],
  ])("%s: still asks (payment)", (_n, a) => expect(taskModeDecision(a)).toEqual({ auto: false, why: "payment" }));

  it.each([
    ["delete repo", tool("github", "delete_repo")],
    ["delete branch", tool("github", "delete_branch")],
    ["remove collaborator", tool("github", "remove_collaborator")],
    ["trash email", tool("google", "gmail_trash")],
    ["delete event", tool("google", "calendar_delete_event")],
    ["trash file", tool("google", "drive_trash")],
    ["delete file forever", tool("google", "drive_delete_permanently")],
    ["delete Vercel project", tool("vercel", "delete_project")],
    ["remove domain", tool("vercel", "remove_domain")],
    ["delete env var", tool("vercel", "delete_env_var")],
    ["delete Supabase project", tool("supabase", "delete_project")],
    ["delete bucket", tool("supabase", "delete_bucket")],
    ["DROP TABLE", tool("supabase", "run_sql", { query: "drop table notes" })],
    ["DELETE rows", tool("supabase", "run_sql", { query: "delete from notes where id = 1" })],
    ["TRUNCATE", tool("supabase", "apply_migration", { query: "truncate notes" })],
    ["a delete by summary", { action_type: "create_task", summary: "Delete all my tasks", payload: {} }],
  ])("%s: still asks (delete)", (_n, a) => expect(taskModeDecision(a)).toEqual({ auto: false, why: "delete" }));

  it("reads prices", () => {
    expect(looksLikeMoney("₹450")).toBe(true);
    expect(looksLikeMoney("$12.99")).toBe(true);
    expect(looksLikeMoney("free")).toBe(false);
    expect(looksLikeMoney("0")).toBe(false);
    expect(looksLikeMoney("")).toBe(false);
  });
});

describe("auto-approve path", () => {
  const pending = (row: Record<string, unknown>) => {
    const r = { id: crypto.randomUUID(), user_id: U, status: "pending", conversation_id: CONV, project_id: null, task_id: null, destination: "TARGET", created_at: new Date().toISOString(), ...row };
    h.db.tables.approval_requests.push(r);
    return r.id as string;
  };

  it("runs a schedule right away, marks it auto and logs it", async () => {
    const id = pending({ action_type: "create_schedule", summary: "Remind me to check email every Monday 9:00", payload: { title: "Check email", prompt: "Remind me to check email", cadence: "weekly", weekday: "1", run_on: "", interval_hours: "", time_of_day: "09:00", timezone: "Asia/Kolkata" } });
    const r = await autoApprove(h.db as unknown as Db, U, id);
    expect(r).toMatchObject({ auto: true, ok: true });
    const row = h.db.tables.approval_requests.find((x) => x.id === id)!;
    expect(row).toMatchObject({ status: "executed", auto: true, decided_by: U });
    expect(h.db.tables.scheduled_jobs).toHaveLength(1);
    expect(h.db.tables.activity_events.some((e) => /Approved automatically \(task mode\)/.test(String(e.title)) && e.approval_id === id)).toBe(true);
    expect(h.db.tables.activity_events.some((e) => /^Done: /.test(String(e.title)) && e.approval_id === id)).toBe(true);
  });

  it("adds a task and starts a project", async () => {
    const t = pending({ action_type: "create_task", summary: "Add the task “Call bank”", payload: { title: "Call bank", notes: "" } });
    const p = pending({ action_type: "create_project", summary: "Create the project “Move”", payload: { name: "Move", description: "" } });
    expect(await autoApprove(h.db as unknown as Db, U, t)).toMatchObject({ auto: true, ok: true });
    expect(await autoApprove(h.db as unknown as Db, U, p)).toMatchObject({ auto: true, ok: true });
    expect(h.db.tables.tasks.some((x) => x.title === "Call bank")).toBe(true);
    expect(h.db.tables.projects.some((x) => x.name === "Move")).toBe(true);
  });

  it("queues a create-account browser job (server-side, with the service role too)", async () => {
    h.db.tables.browser_jobs.push({ id: JOB, user_id: U, status: "needs_approval", inputs: { account: { flow: "register", site: "demo.example.com", email: "a@example.com" } }, allowed_secrets: [], log: [] });
    const id = pending({ action_type: "site_account", summary: "Create a new account on demo.example.com", payload: { browser_job_id: JOB, flow: "register", site: "demo.example.com", email: "a@example.com" } });
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    const r = await autoApprove(h.db.admin() as unknown as Db, U, id);
    expect(r).toMatchObject({ auto: true, ok: true });
    expect(h.db.tables.browser_jobs[0].status).toBe("queued");
    expect(h.db.tables.approval_requests.find((x) => x.id === id)).toMatchObject({ auto: true, decided_by: U });
  });

  it("leaves payments and deletes pending for the card", async () => {
    const pay = pending({ action_type: "purchase", summary: "Pay ₹499 at Store", payload: { browser_job_id: JOB, total: "₹499" } });
    const del = pending({ action_type: "connector_tool", summary: "Delete repository a/b", payload: { connector: "github", tool: "delete_repo", args: {} } });
    expect(await autoApprove(h.db as unknown as Db, U, pay)).toEqual({ auto: false, why: "payment" });
    expect(await autoApprove(h.db as unknown as Db, U, del)).toEqual({ auto: false, why: "delete" });
    for (const id of [pay, del]) {
      const row = h.db.tables.approval_requests.find((x) => x.id === id)!;
      expect(row.status).toBe("pending");
      expect(row.auto).toBeFalsy();
    }
  });

  it("never touches a request that isn't pending", async () => {
    const id = pending({ action_type: "create_task", summary: "Add", payload: { title: "x" }, status: "rejected" });
    expect(await autoApprove(h.db as unknown as Db, U, id)).toEqual({ auto: false, why: "not_pending" });
  });

  it("shows a compact Done automatically card", () => {
    render(<ApprovalCard id="a1" initial={{ id: "a1", action_type: "create_schedule", summary: "Remind me every Monday 9:00", destination: "TARGET", payload: {}, status: "executed", auto: true, project_id: null, conversation_id: CONV, task_id: null, decided_at: null, executed_at: null, result: null, error: null, created_at: new Date().toISOString() }} />);
    expect(screen.getByTestId("approval-auto")).toHaveTextContent("Done automatically");
    expect(screen.queryByTestId("approve-btn")).toBeNull();
  });
});

describe("turning it on", () => {
  it("/task and 'task mode on|off' commands", () => {
    expect(taskModeCommand("/task create a note")).toEqual({ on: true, text: "create a note" });
    expect(taskModeCommand("task mode on")).toMatchObject({ on: true });
    expect(taskModeCommand("Task mode off please")).toMatchObject({ on: false });
    expect(taskModeCommand("what is task management")).toBeNull();
  });

  it("the toggle is saved on the chat", async () => {
    const res = await patchConversation(new Request(`https://t.test/api/conversations/${CONV}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_mode: true }) }), { params: Promise.resolve({ id: CONV }) });
    expect(res.status).toBe(200);
    expect(h.db.tables.conversations[0].task_mode).toBe(true);
    expect(h.db.tables.conversations[0].title).toBe("t");
    expect(await chatTaskMode(h.db as unknown as Db, U, CONV)).toBe(true);
    const bad = await patchConversation(new Request(`https://t.test/api/conversations/${CONV}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_mode: "yes" }) }), { params: Promise.resolve({ id: CONV }) });
    expect(bad.status).toBe(400);
  });

  it("the composer toggle saves it and sends it with the message", async () => {
    const f = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/conversations/")) return new Response(JSON.stringify({ conversation: { id: CONV, task_mode: true } }));
      if (String(url) === "/api/chat") return new Response("ok", { headers: { "X-Conversation-Id": CONV, "X-Task-Mode": "1" } });
      return new Response("{}");
    });
    vi.stubGlobal("fetch", f);
    render(<Chat conversationId={CONV} initialTaskMode={false} />);
    const t = screen.getByTestId("task-mode-toggle");
    expect(t).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(t);
    expect(t).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(f).toHaveBeenCalledWith(`/api/conversations/${CONV}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ task_mode: true }) })));
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "create a note" } });
    fireEvent.submit(screen.getByTestId("chat-input").closest("form")!);
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/chat", expect.anything()));
    const body = JSON.parse(String(f.mock.calls.find((c) => c[0] === "/api/chat")![1].body));
    expect(body).toMatchObject({ conversationId: CONV, message: "create a note", taskMode: true });
  });

  it("the task-mode prompt tells the model not to ask and to note its choices", () => {
    expect(TASK_MODE_PROMPT).toMatch(/without stopping to ask/);
    expect(TASK_MODE_PROMPT).toMatch(/most reasonable choice/);
    expect(TASK_MODE_PROMPT).toMatch(/payments and deletes/);
  });
});
