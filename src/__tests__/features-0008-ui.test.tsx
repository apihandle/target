// UI pieces for migration 0008 features: voice button support detection, pinned chats in the sidebar,
// model picker + templates in the chat composer.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VoiceButton from "@/components/VoiceButton";
import Sidebar from "@/components/Sidebar";
import Chat from "@/components/Chat";

afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition; });

function streamResponse(parts: string[]) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), { status: 200 });
}

describe("voice input", () => {
  it("hides the mic when the browser has no Web Speech API", () => {
    render(<VoiceButton onText={() => undefined} />);
    expect(screen.queryByTestId("voice-btn")).toBeNull();
  });
  it("appends the final transcript when supported", async () => {
    const onText = vi.fn();
    class FakeRec {
      lang = ""; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror = null; onend: (() => void) | null = null;
      start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "plan my week" }], { isFinal: true })] }); this.onend?.(); }, 0); }
      stop() {} abort() {}
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRec;
    render(<VoiceButton onText={onText} />);
    fireEvent.click(await screen.findByTestId("voice-btn"));
    await waitFor(() => expect(onText).toHaveBeenCalledWith("plan my week"));
  });
});

describe("sidebar pin + search", () => {
  it("shows pinned chats above recent ones and pins via the API", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    render(<Sidebar email="a@x.test" conversations={[{ id: "c1", title: "Recent one" }, { id: "c2", title: "Pinned one", pinned: true }]} />);
    expect(screen.getByTestId("pinned-list")).toHaveTextContent("Pinned one");
    expect(screen.getByTestId("pinned-list")).not.toHaveTextContent("Recent one");
    fireEvent.click(screen.getByLabelText("Options for Recent one"));
    fireEvent.click(screen.getByTestId("pin-btn"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/conversations/c1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ pinned: true }) })));
    expect(screen.getByTestId("pinned-list")).toHaveTextContent("Recent one");
  });
  it("renames and deletes a chat from its menu", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("confirm", () => true);
    render(<Sidebar email="a@x.test" conversations={[{ id: "c1", title: "Old name" }, { id: "c3", title: "Bye" }]} />);
    fireEvent.click(screen.getByLabelText("Options for Old name"));
    fireEvent.click(screen.getByTestId("rename-btn"));
    fireEvent.change(screen.getByTestId("rename-input"), { target: { value: "New name" } });
    fireEvent.submit(screen.getByTestId("rename-input"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/conversations/c1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "New name" }) })));
    expect(screen.getByText("New name")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Options for Bye"));
    fireEvent.click(screen.getByTestId("delete-btn"));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/conversations/c3", { method: "DELETE" }));
    expect(screen.queryByText("Bye")).toBeNull();
  });
  it("searches chats as you type", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ id: "c9", title: "Goa trip", pinned: false, snippet: "…beach in Goa…" }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    render(<Sidebar email="a@x.test" conversations={[]} />);
    fireEvent.change(screen.getByTestId("chat-search"), { target: { value: "goa" } });
    expect(await screen.findByTestId("search-hit")).toHaveTextContent("Goa trip");
    expect(f.mock.calls[0][0]).toBe("/api/conversations/search?q=goa");
  });
});

describe("chat composer", () => {
  it("sends the picked model (and only then) and remembers it", async () => {
    const f = vi.fn(async (url: string) => (url === "/api/chat" ? streamResponse(["ok"]) : new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", f);
    render(<Chat models={[{ id: "auto", label: "Auto" }, { id: "nvidia:a", label: "a" }, { id: "openrouter:b", label: "b" }]} />);
    fireEvent.change(screen.getByTestId("model-picker"), { target: { value: "openrouter:b" } });
    expect(f).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ preferred_model: "openrouter:b" }) }));
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === "/api/chat")).toBe(true));
    const call = f.mock.calls.find((c) => c[0] === "/api/chat")!;
    expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string)).toEqual({ message: "hello", model: "openrouter:b" });
  });
  it("fills the composer from a built-in template without sending", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ templates: [] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    render(<Chat />);
    fireEvent.click(screen.getByTestId("templates-btn"));
    fireEvent.click(screen.getByText("Code review"));
    expect((screen.getByTestId("chat-input") as HTMLTextAreaElement).value).toMatch(/^Review this code/);
    expect(f.mock.calls.every((c) => (c as unknown[])[0] !== "/api/chat")).toBe(true);
  });
});
