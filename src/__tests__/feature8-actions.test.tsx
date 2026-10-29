import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import Chat from "@/components/Chat";
import ActionButtons from "@/components/ActionButtons";
import { splitActions, sanitizeAction, calendarUrl, mapUrl } from "@/lib/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const block = '```actions\n[{"type":"map","query":"Golghar, Patna"},{"type":"calendar","title":"Visit Golghar","start":"2026-11-02T10:00:00+05:30"},{"type":"memory","content":"Likes history"},{"type":"link","label":"x","url":"javascript:alert(1)"}]\n```';

describe("Feature 8: action buttons", () => {
  it("splits actions out of markdown and caps at 3", () => {
    const r = splitActions("Go to **Golghar**.\n\n" + block);
    expect(r.text).toBe("Go to **Golghar**.");
    expect(r.actions.map((a) => a.type)).toEqual(["map", "calendar", "memory"]);
  });

  it("hides a half-streamed block and drops malformed ones", () => {
    expect(splitActions('Hi\n```actions\n[{"type":"ma').text).toBe("Hi");
    expect(splitActions("Hi\n```actions\nnot json```").actions).toEqual([]);
  });

  it("rejects unsafe or invalid actions", () => {
    expect(sanitizeAction({ type: "link", label: "x", url: "javascript:alert(1)" })).toBeNull();
    expect(sanitizeAction({ type: "calendar", title: "x", start: "someday" })).toBeNull();
    expect(sanitizeAction({ type: "shell", cmd: "rm" })).toBeNull();
    expect(sanitizeAction({ type: "panel", kind: "weather", config: { city: "Patna" } })).toMatchObject({ kind: "weather" });
  });

  it("builds calendar and map links", () => {
    const u = calendarUrl({ type: "calendar", title: "Visit", start: "2026-11-02T10:00:00+05:30" });
    expect(u).toContain("dates=20261102T043000Z%2F20261102T053000Z");
    expect(mapUrl("Golghar, Patna")).toBe("https://www.google.com/maps/search/?api=1&query=Golghar%2C%20Patna");
  });

  it("renders buttons under a finished reply", async () => {
    const enc = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("Go to Golghar.\n\n")); c.enqueue(enc.encode(block)); c.close(); } }))));
    render(<Chat />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "patna mein kya dekhu" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getAllByTestId("action")).toHaveLength(3));
    expect(screen.getByTestId("msg-assistant")).not.toHaveTextContent("```");
    expect(screen.getAllByTestId("action")[0]).toHaveAttribute("href", expect.stringContaining("google.com/maps"));
  });

  it("memory and panel buttons call the APIs once", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", f);
    render(<ActionButtons actions={[{ type: "memory", content: "Likes history" }, { type: "panel", kind: "weather", config: { city: "Patna" } }]} />);
    fireEvent.click(screen.getAllByTestId("action")[0]);
    await waitFor(() => expect(screen.getAllByTestId("action")[0]).toHaveTextContent("Saved to memory"));
    fireEvent.click(screen.getAllByTestId("action")[1]);
    await waitFor(() => expect(screen.getAllByTestId("action")[1]).toHaveTextContent("Added to Home"));
    expect(f.mock.calls.map((c) => c[0])).toEqual(["/api/memories", "/api/panels"]);
    expect(screen.getAllByTestId("action")[0]).toBeDisabled();
  });
});

import { heuristicActions, mergeActions } from "@/lib/actions";
import { isTransient, parseFacts } from "@/lib/memory";
describe("Feature 8: fallbacks", () => {
  it("suggests a crypto panel when user wants to track a coin", () => {
    expect(heuristicActions("Main Bitcoin ka price roz check karna chahta hoon")).toEqual([{ type: "panel", kind: "crypto", title: "BTC price", config: { symbol: "BTC", currency: "INR" } }]);
    expect(heuristicActions("bitcoin kya hai")).toEqual([]);
    expect(mergeActions([{ type: "map", query: "a" }], [{ type: "map", query: "a" }, { type: "map", query: "b" }])).toHaveLength(2);
  });
  it("drops time-bound plans from memory", () => {
    expect(isTransient("Travels to Golghar Patna at 9 AM tomorrow")).toBe(true);
    expect(isTransient("Lives in Patna")).toBe(false);
    expect(parseFacts('["Meeting friend tomorrow", "Is vegetarian"]')).toEqual(["Is vegetarian"]);
  });
});
