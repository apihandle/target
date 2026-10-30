import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import Chat from "@/components/Chat";
import { parseSSE, titleFrom } from "@/lib/ai";

function streamResponse(chunks: string[], headers: Record<string, string> = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
  });
  return new Response(body, { status: 200, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe("Feature 4: streaming chat", () => {
  it("parseSSE extracts deltas, keeps partial line, detects DONE", () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
      ': keep-alive\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n' +
      "data: [DONE]\n" +
      'data: {"choices":[{"del';
    const r = parseSSE(buf);
    expect(r.deltas).toEqual(["Hel", "lo"]);
    expect(r.done).toBe(true);
    expect(r.rest).toBe('data: {"choices":[{"del');
  });

  it("titleFrom trims long text", () => {
    expect(titleFrom("  hi   there ")).toBe("hi there");
    expect(titleFrom("x".repeat(80)).length).toBeLessThanOrEqual(48);
  });

  it("sends a message and renders streamed reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["Namaste", " **Vikash**"], { "X-Conversation-Id": "c1" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Chat />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("msg-assistant")).toHaveTextContent("Namaste Vikash"));
    expect(screen.getByTestId("msg-user")).toHaveTextContent("hello");
    expect(screen.getByText("Vikash").tagName).toBe("STRONG");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: "hello" });
  });

  it("starter prompt sends immediately; continues conversation id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["ok"]));
    vi.stubGlobal("fetch", fetchMock);
    render(<Chat conversationId="abc" />);
    fireEvent.click(screen.getAllByTestId("starter")[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).conversationId).toBe("abc");
  });

  it("shows API error and removes empty bubble", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "AI is not configured" }), { status: 503 })));
    render(<Chat />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(await screen.findByTestId("chat-error")).toHaveTextContent("AI is not configured");
    expect(screen.queryByTestId("msg-assistant")).toBeNull();
  });

  it("renders saved history and blocks empty send", () => {
    render(<Chat conversationId="x" initialMessages={[{ role: "user", content: "q" }, { role: "assistant", content: "a" }]} />);
    expect(screen.getAllByTestId(/msg-/)).toHaveLength(2);
    expect(screen.getByTestId("chat-send")).toBeDisabled();
  });

  it("regenerates the last reply in place and copies a reply", async () => {
    const f = vi.fn(async () => streamResponse(["fresh answer"]));
    vi.stubGlobal("fetch", f);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Chat conversationId="c1" initialMessages={[{ role: "user", content: "q" }, { role: "assistant", content: "old answer" }]} />);
    fireEvent.click(screen.getByTestId("copy-reply"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("old answer"));
    fireEvent.click(screen.getByTestId("regenerate-reply"));
    await waitFor(() => expect(screen.getAllByTestId("msg-assistant")[0]).toHaveTextContent("fresh answer"));
    expect(screen.getAllByTestId("msg-assistant")).toHaveLength(1);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ conversationId: "c1", message: "q", retry: true, regenerate: true });
  });
});
