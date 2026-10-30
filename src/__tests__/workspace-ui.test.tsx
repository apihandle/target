import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import ApprovalCard from "@/components/ApprovalCard";
import ActionButtons from "@/components/ActionButtons";
import TaskList from "@/components/TaskList";
import Chat from "@/components/Chat";
import Connections from "@/components/Connections";
import QuickActions from "@/components/QuickActions";
import PanelHome from "@/components/PanelHome";
import MemoryManager from "@/components/MemoryManager";
import ProjectDetail from "@/components/ProjectDetail";
import { integrationViews } from "@/lib/integrations/registry";
import { DEFAULT_QUICK_ACTIONS } from "@/lib/settings";
import type { Approval } from "@/lib/approvals";
import type { Task } from "@/lib/tasks";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
const AID = "55555555-5555-4555-8555-555555555555";

const pending: Approval = {
  id: AID, action_type: "calendar_event", summary: "Add “Dentist” on Mon, 2 Nov", destination: "Your Google Calendar (primary)",
  payload: { title: "Dentist", start: "2026-11-02T04:30:00.000Z", end: "2026-11-02T05:30:00.000Z", location: "Patna" },
  status: "pending", project_id: null, conversation_id: null, task_id: null, decided_at: null, executed_at: null, result: null, error: null, created_at: "",
};

describe("approval UI", () => {
  it("shows what, where and details, then approves through the server", async () => {
    const f = vi.fn().mockResolvedValue(ok({ approval: { ...pending, status: "executed", result: { link: "https://calendar.google.com/e/1" } } }));
    vi.stubGlobal("fetch", f);
    render(<ApprovalCard id={AID} initial={pending} />);
    const card = screen.getByTestId("approval-card");
    expect(card).toHaveTextContent("Your Google Calendar (primary)");
    expect(card).toHaveTextContent("Patna");
    expect(card).toHaveTextContent("Nothing happens until you approve");
    fireEvent.click(screen.getByTestId("approve-btn"));
    await waitFor(() => expect(screen.getByTestId("approval-result")).toHaveTextContent("Done"));
    expect(f).toHaveBeenCalledWith(`/api/approvals/${AID}`, expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "approve" }) }));
    expect(screen.queryByTestId("approve-btn")).toBeNull();
  });

  it("reject sends a reject decision and shows nothing was done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ approval: { ...pending, status: "rejected" } })));
    render(<ApprovalCard id={AID} initial={pending} />);
    fireEvent.click(screen.getByTestId("reject-btn"));
    await waitFor(() => expect(screen.getByTestId("approval-card")).toHaveAttribute("data-status", "rejected"));
    expect(screen.getByText("Nothing was done.")).toBeInTheDocument();
  });

  it("chat approval cards load their details from the server, not from chat text", async () => {
    const f = vi.fn().mockResolvedValue(ok({ approval: pending }));
    vi.stubGlobal("fetch", f);
    render(<ActionButtons actions={[{ type: "approval", id: AID }, { type: "unavailable", label: "Can't send an email", reason: "TARGET can't send email in this version." }]} />);
    expect(screen.getByTestId("action-unavailable")).toHaveTextContent("can't send email");
    await waitFor(() => expect(screen.getByTestId("approval-card")).toBeInTheDocument());
    expect(f).toHaveBeenCalledWith(`/api/approvals/${AID}`);
    expect(screen.getAllByTestId("approve-btn")).toHaveLength(1); // the limitation has no approve button
  });

  it("shows a failure with retry", () => {
    render(<ApprovalCard id={AID} initial={{ ...pending, status: "failed", error: "Google said no" }} />);
    expect(screen.getByTestId("approval-error")).toHaveTextContent("Google said no");
    expect(screen.getByTestId("approve-btn")).toHaveTextContent("Approve & retry");
  });
});

describe("tasks UI", () => {
  const t: Task = { id: "t1", title: "Book hotel", notes: "", status: "queued", progress: "", error: null, origin: "user", project_id: "p1", conversation_id: null };
  it("validates near the field, adds a task, and changes status", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ task: { ...t, id: "t2", title: "Pack" } }, 201))
      .mockResolvedValueOnce(ok({ task: { ...t, status: "completed" } }));
    vi.stubGlobal("fetch", f);
    render(<TaskList initial={[t]} projectId="p1" />);
    fireEvent.click(screen.getByTestId("task-add"));
    expect(screen.getByTestId("new-task-error")).toHaveTextContent("title");
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("task-title"), { target: { value: "Pack" } });
    fireEvent.click(screen.getByTestId("task-add"));
    await waitFor(() => expect(screen.getAllByTestId("task-item")).toHaveLength(2));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ title: "Pack", project_id: "p1" });
    fireEvent.change(screen.getAllByTestId("task-status")[1], { target: { value: "completed" } });
    await waitFor(() => expect(screen.getAllByTestId("task-item")[1]).toHaveAttribute("data-status", "completed"));
    expect(screen.getAllByTestId("task-chat")[0]).toHaveAttribute("href", "/app?t=t2&p=p1");
  });
  it("failed tasks explain why and offer a retry", () => {
    render(<TaskList initial={[{ ...t, status: "failed", error: "AI quota used up" }]} />);
    expect(screen.getByTestId("task-failure")).toHaveTextContent("AI quota used up");
    expect(screen.getByTestId("task-chat")).toHaveTextContent("Retry");
  });
  it("delete needs confirmation", async () => {
    const f = vi.fn().mockResolvedValue(ok({ ok: true }));
    vi.stubGlobal("fetch", f);
    render(<TaskList initial={[t]} />);
    fireEvent.click(screen.getByTestId("task-delete"));
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("task-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("tasks-empty")).toBeInTheDocument());
  });
});

describe("chat controls", () => {
  it("shows a setup state and refuses to send when AI isn't configured", () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    render(<Chat aiConfigured={false} />);
    expect(screen.getByTestId("ai-setup")).toHaveTextContent("isn't set up");
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    expect(screen.getByTestId("chat-send")).toBeDisabled();
    expect(f).not.toHaveBeenCalled();
  });

  it("Stop cancels the stream and keeps the partial reply", async () => {
    const enc = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode("Partial answer")); init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); },
    }), { headers: { "X-Conversation-Id": "c1" } }))));
    render(<Chat />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "long question" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("msg-assistant")).toHaveTextContent("Partial answer"));
    fireEvent.click(screen.getByTestId("chat-stop"));
    await waitFor(() => expect(screen.getByTestId("msg-assistant")).toHaveTextContent("[Response stopped]"));
    expect(screen.queryByTestId("chat-error")).toBeNull();
  });

  it("Retry re-sends the failed message to the same chat without duplicating it", async () => {
    const enc = new TextEncoder();
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ error: "AI error 502", conversationId: "c9" }, 502))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("Second try")); c.close(); } })));
    vi.stubGlobal("fetch", f);
    render(<Chat />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "plan my week" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    const err = await screen.findByTestId("chat-error");
    await act(async () => { fireEvent.click(err.querySelector("button")!); });
    await waitFor(() => expect(screen.getByTestId("msg-assistant")).toHaveTextContent("Second try"));
    expect(screen.getAllByTestId("msg-user")).toHaveLength(1);
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ conversationId: "c9", message: "plan my week", retry: true });
  });

  it("quick action prefill is editable and not auto-sent; tasks are sent once", async () => {
    const enc = new TextEncoder();
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("ok")); c.close(); } }))));
    vi.stubGlobal("fetch", f);
    render(<Chat initialPrompt="Plan my week" taskId="t1" taskTitle="Plan week" />);
    expect(screen.getByTestId("chat-input")).toHaveValue("Plan my week");
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ message: "Plan my week", taskId: "t1" });
  });
});

describe("connected apps, quick actions, panels, memory", () => {
  it("shows Setup required (never Connected) when the server isn't configured", () => {
    render(<Connections initial={integrationViews({}, [])} />);
    const cal = screen.getAllByTestId("integration").find((e) => e.getAttribute("data-id") === "google_calendar")!;
    expect(cal).toHaveTextContent("Setup required");
    expect(cal).toHaveTextContent("GOOGLE_OAUTH_CLIENT_ID");
    expect(screen.queryByTestId("integration-connect")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("disconnect asks first and then calls the server", async () => {
    const f = vi.fn().mockResolvedValue(ok({ ok: true }));
    vi.stubGlobal("fetch", f);
    const env = { GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", TOKEN_ENCRYPTION_KEY: "c", SUPABASE_SERVICE_ROLE_KEY: "d" };
    render(<Connections initial={integrationViews(env, [{ provider: "google_calendar", account_label: "me@x.com" }])} />);
    fireEvent.click(screen.getByTestId("integration-disconnect"));
    fireEvent.click(screen.getByTestId("integration-disconnect-confirm"));
    await waitFor(() => expect(screen.getByTestId("integration-connect")).toHaveAttribute("href", "/api/integrations/google_calendar/connect"));
    expect(f).toHaveBeenCalledWith("/api/integrations/google_calendar", { method: "DELETE" });
  });

  it("quick actions link to a pre-filled chat and can be hidden", async () => {
    const f = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", f);
    render(<QuickActions actions={DEFAULT_QUICK_ACTIONS} hidden={[]} />);
    const links = screen.getAllByTestId("quick-action");
    expect(links[0]).toHaveAttribute("href", expect.stringMatching(/^\/app\?q=Help%20me%20plan%20my%20week/));
    expect(links[2]).toHaveAttribute("href", "/app/projects?new=1");
    fireEvent.click(screen.getAllByTestId("quick-action-hide")[0]);
    await waitFor(() => expect(screen.getAllByTestId("quick-action")).toHaveLength(3));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ hidden_quick_actions: ["plan-week"] });
  });

  it("creates a list panel and adds an item", async () => {
    const list = { id: "l1", kind: "list", title: "Packing", description: "For Goa", config: {}, data: {}, items: [] };
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ panel: list }, 201))
      .mockResolvedValueOnce(ok({ panel: { ...list, items: [{ id: "i1", text: "Passport", done: false }] } }));
    vi.stubGlobal("fetch", f);
    render(<PanelHome initial={[]} />);
    fireEvent.click(screen.getByTestId("panel-add-open"));
    fireEvent.click(screen.getByTestId("type-list"));
    expect(screen.queryByTestId("panel-value")).toBeNull();
    fireEvent.change(screen.getByTestId("panel-title"), { target: { value: "Packing" } });
    fireEvent.change(screen.getByTestId("panel-description"), { target: { value: "For Goa" } });
    fireEvent.click(screen.getByTestId("panel-add"));
    await waitFor(() => expect(screen.getByTestId("panel")).toHaveAttribute("data-kind", "list"));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ kind: "list", title: "Packing", config: {}, description: "For Goa" });
    fireEvent.change(screen.getByTestId("panel-item-input"), { target: { value: "Passport" } });
    fireEvent.click(screen.getByTestId("panel-item-add"));
    await waitFor(() => expect(screen.getByTestId("list-body")).toHaveTextContent("Passport"));
    expect(f.mock.calls[1][0]).toBe("/api/panels/l1");
    expect(JSON.parse(f.mock.calls[1][1].body).items[0]).toMatchObject({ text: "Passport", done: false });
  });

  it("memory can be turned off and edited", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ settings: { memory_enabled: false } }))
      .mockResolvedValueOnce(ok({ memory: { id: "1", content: "Loves chai", source: "manual" } }));
    vi.stubGlobal("fetch", f);
    render(<MemoryManager initial={[{ id: "1", content: "Likes tea", source: "chat" }]} />);
    fireEvent.click(screen.getByTestId("memory-toggle"));
    await waitFor(() => expect(screen.getByTestId("memory-toggle")).toHaveAttribute("aria-checked", "false"));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ memory_enabled: false });
    fireEvent.click(screen.getByTestId("memory-edit"));
    fireEvent.change(screen.getByLabelText("Edit memory"), { target: { value: "Loves chai" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByTestId("memory-item")).toHaveTextContent("Loves chai"));
    expect(f.mock.calls[1][1].method).toBe("PATCH");
  });

  it("projects can be archived", async () => {
    const f = vi.fn().mockResolvedValue(ok({ project: {} }));
    vi.stubGlobal("fetch", f);
    render(<ProjectDetail project={{ id: "p1", name: "Goa", instructions: "", description: "Beach", status: "active" }} chats={[]} />);
    fireEvent.click(screen.getByTestId("pd-archive"));
    await waitFor(() => expect(screen.getByTestId("pd-status")).toHaveTextContent("Archived"));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ status: "archived" });
  });
});
