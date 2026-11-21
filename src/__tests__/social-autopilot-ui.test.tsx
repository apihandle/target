// The Blogger autopilot card on /app/social: it reports the prerequisites from the page's existing
// status (Blogger connected / a blog chosen / a Gemini key saved), shows the on/off state plainly,
// and saves the switch + topic to /api/social/autopilot — never an admin route.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BloggerAutopilotCard from "@/components/admin/BloggerAutopilotCard";

function stubFetch() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url) === "/api/social/autopilot" && method === "POST") {
      return new Response(JSON.stringify({ autopilot: { enabled: true, topic: "Free AI tools" } }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Blogger autopilot card", () => {
  it("all prerequisites ready and off → invites the user to turn it on", () => {
    stubFetch();
    render(<BloggerAutopilotCard initial={{ enabled: false, topic: "" }} bloggerConnected blogName="My Blog" geminiSaved />);
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("Everything autopilot needs is set up");
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("My Blog");
    expect(screen.getByTestId("autopilot-toggle")).not.toBeChecked();
  });

  it("missing prerequisites are named in the status line", () => {
    stubFetch();
    render(<BloggerAutopilotCard initial={{ enabled: false, topic: "" }} bloggerConnected={false} blogName={null} geminiSaved={false} />);
    const status = screen.getByTestId("autopilot-status");
    expect(status).toHaveTextContent("connect Blogger above");
    expect(status).toHaveTextContent("save your Gemini key above");
  });

  it("connected but no blog chosen → the missing piece is the blog choice", () => {
    stubFetch();
    render(<BloggerAutopilotCard initial={{ enabled: true, topic: "Free AI tools" }} bloggerConnected blogName={null} geminiSaved />);
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("choose a blog above");
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("can't post yet");
  });

  it("on and ready → the status line says posts go out every 4 hours", () => {
    stubFetch();
    render(<BloggerAutopilotCard initial={{ enabled: true, topic: "Free AI tools" }} bloggerConnected blogName="My Blog" geminiSaved />);
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("Autopilot is on");
    expect(screen.getByTestId("autopilot-status")).toHaveTextContent("every 4 hours");
    expect(screen.getByTestId("autopilot-toggle")).toBeChecked();
    expect(screen.getByTestId("autopilot-topic")).toHaveValue("Free AI tools");
  });

  it("saving posts the switch + topic to the user route and confirms", async () => {
    const calls = stubFetch();
    render(<BloggerAutopilotCard initial={{ enabled: false, topic: "" }} bloggerConnected blogName="My Blog" geminiSaved />);
    await userEvent.click(screen.getByTestId("autopilot-toggle"));
    await userEvent.type(screen.getByTestId("autopilot-topic"), "Free AI tools");
    await userEvent.click(screen.getByTestId("autopilot-save"));
    await waitFor(() => expect(screen.getByText(/Autopilot is on — the next post goes out/)).toBeTruthy());
    const save = calls.find((c) => c.url === "/api/social/autopilot")!;
    expect(save.method).toBe("POST");
    expect(save.body).toEqual({ enabled: true, topic: "Free AI tools" });
    expect(calls.some((c) => c.url.startsWith("/api/admin/"))).toBe(false);
  });
});
