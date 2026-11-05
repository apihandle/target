// Feedback UI: the /app form posts the message + path; the admin sidebar shows AI usage and the new-feedback badge;
// admin status changes go through the confirm dialog.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/app/projects" }));

import FeedbackForm from "@/components/FeedbackForm";
import FeedbackButton from "@/components/FeedbackButton";
import MyFeedback from "@/components/MyFeedback";
import FeedbackActions from "@/components/admin/FeedbackActions";
import AdminFrame from "@/components/admin/AdminFrame";

let calls: { url: string; body: Record<string, unknown> }[] = [];
let reply: () => Response = () => new Response(JSON.stringify({ ok: true }), { status: 201 });
beforeEach(() => {
  calls = [];
  reply = () => new Response(JSON.stringify({ ok: true }), { status: 201 });
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  }) as unknown as typeof fetch;
});

describe("FeedbackForm", () => {
  it("sends category, message and page path; shows thanks", async () => {
    render(<FeedbackForm pagePath="/app/projects" />);
    expect(screen.getByTestId("feedback-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("feedback-cat-idea"));
    fireEvent.change(screen.getByTestId("feedback-input"), { target: { value: "Add dark mode" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => expect(screen.getByTestId("feedback-sent")).toBeInTheDocument());
    expect(calls[0]).toEqual({ url: "/api/feedback", body: { message: "Add dark mode", category: "idea", page_path: "/app/projects" } });
  });
  it("shows the server's error (rate limit) and keeps the text", async () => {
    reply = () => new Response(JSON.stringify({ error: "You've sent a lot of feedback in the last hour." }), { status: 429 });
    render(<FeedbackForm pagePath="/app" />);
    fireEvent.change(screen.getByTestId("feedback-input"), { target: { value: "Broken button" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => expect(screen.getByTestId("feedback-message-error")).toHaveTextContent("last hour"));
    expect(screen.getByTestId("feedback-input")).toHaveValue("Broken button");
  });
  it("sidebar button opens the form in a dialog with the current path", async () => {
    window.history.pushState({}, "", "/app/projects?c=123");
    render(<FeedbackButton />);
    fireEvent.click(screen.getByTestId("feedback-open"));
    expect(screen.getByTestId("feedback-dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("feedback-input"), { target: { value: "Hello team" } });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => expect(calls[0]?.body.page_path).toBe("/app/projects"));
  });
});

describe("MyFeedback list states", () => {
  it("empty", async () => {
    reply = () => new Response(JSON.stringify({ items: [], more: false }), { status: 200 });
    render(<MyFeedback />);
    expect(screen.getByTestId("my-feedback-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("my-feedback-empty")).toBeInTheDocument());
  });
  it("error", async () => {
    reply = () => new Response("{}", { status: 500 });
    render(<MyFeedback />);
    await waitFor(() => expect(screen.getByTestId("my-feedback-error")).toBeInTheDocument());
  });
  it("items + load more", async () => {
    let page = 0;
    reply = () => { page++; return new Response(JSON.stringify({ items: [{ id: `f${page}`, message: `msg ${page}`, category: "bug", page_path: null, status: page === 1 ? "done" : "new", created_at: "2026-11-05T00:00:00Z" }], more: page === 1 }), { status: 200 }); };
    render(<MyFeedback />);
    await waitFor(() => expect(screen.getAllByTestId("my-feedback-item")).toHaveLength(1));
    expect(screen.getByText("Done")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("my-feedback-more"));
    await waitFor(() => expect(screen.getAllByTestId("my-feedback-item")).toHaveLength(2));
    expect(screen.queryByTestId("my-feedback-more")).toBeNull();
  });
});

describe("admin", () => {
  it("sidebar has AI usage + Feedback with a badge for new items", () => {
    render(<AdminFrame badges={{ users: 1, errors24h: 0, jobsActive: 0, scheduledActive: 0, sharesActive: 0, feedbackNew: 4, switchesOff: 0 }} version="v" email="o@x.test" statusSlot={null}><p>x</p></AdminFrame>);
    expect(screen.getByTestId("admin-nav-ai")).toHaveAttribute("href", "/admin/ai-usage");
    expect(screen.getByTestId("admin-nav-feedback")).toHaveTextContent("4");
  });
  it("feedback status change needs the confirm dialog, then posts confirm:true", async () => {
    reply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    render(<FeedbackActions id="f1" status="new" note={null} />);
    expect(screen.getByTestId("feedback-save-f1")).toBeDisabled();
    fireEvent.change(screen.getByTestId("feedback-status"), { target: { value: "done" } });
    fireEvent.click(screen.getByTestId("feedback-save-f1"));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("audit log");
    fireEvent.click(screen.getByTestId("feedback-save-f1-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "/api/admin/feedback/f1", body: { status: "done", note: "", confirm: true } });
  });
});
