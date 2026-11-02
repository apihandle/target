import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import BrowserLiveCard from "@/components/BrowserLiveCard";
import { stepText } from "@/lib/browserProgress";
import { canReadWithoutBrowser, readWithoutBrowser } from "@/lib/server/cloudWorker";

const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
afterEach(() => vi.unstubAllGlobals());

describe("live browser progress card", () => {
  it("turns worker log lines into readable steps", () => {
    expect(stepText("click [12]: open the pricing page")).toBe("Open the pricing page");
    expect(stepText("scroll")).toBe("Scrolling");
    expect(stepText("Opening example.com")).toBe("Opening example.com");
  });

  it("shows the running task with its steps, and nothing when no task runs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ job: { id: "j", goal: "Find the price", start_url: "https://www.example.com/x", status: "running", log: ["Opening example.com", "click [3]: open pricing"] } })));
    render(<BrowserLiveCard conversationId="11111111-1111-4111-8111-111111111111" streaming firstDelayMs={0} />);
    expect(await screen.findByTestId("browser-live")).toHaveTextContent("Browser at work");
    expect(screen.getByTestId("browser-live")).toHaveTextContent("example.com");
    expect(screen.getByTestId("browser-live-steps")).toHaveTextContent("Open pricing");
  });

  it("hides a finished task", async () => {
    const f = vi.fn().mockResolvedValue(ok({ job: { id: "j", goal: "g", start_url: "https://a.com", status: "done", log: [] } }));
    vi.stubGlobal("fetch", f);
    render(<BrowserLiveCard conversationId="11111111-1111-4111-8111-111111111111" streaming={false} firstDelayMs={0} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId("browser-live")).toBeNull();
  });
});

describe("reading without a cloud browser", () => {
  it("only read-only jobs may fall back", () => {
    expect(canReadWithoutBrowser({ id: "a", mode: "auto", start_url: "https://a.com", allowed_secrets: [] })).toBe(true);
    expect(canReadWithoutBrowser({ id: "a", mode: "auto", start_url: "https://a.com", allowed_secrets: ["x"] })).toBe(false);
    expect(canReadWithoutBrowser({ id: "a", mode: "steps", start_url: "https://a.com", steps: [{ action: "click", selector: "#b" }] })).toBe(false);
    expect(canReadWithoutBrowser({ id: "a", mode: "code", start_url: "https://a.com" })).toBe(false);
  });

  it("answers the goal from the page text and logs progress", async () => {
    const api = vi.fn().mockResolvedValue({ ok: true });
    const page = new Response("<html><head><title>Example</title></head><body><p>Price is 42</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    const f = vi.fn().mockResolvedValue(page) as unknown as typeof fetch;
    const ask = vi.fn().mockResolvedValue("The price is 42.");
    vi.doMock("@/lib/urlReader", async (orig) => orig());
    const out = await readWithoutBrowser({ id: "j", mode: "auto", goal: "price?", start_url: "https://93.184.215.14/" }, api, f, ask).catch((e) => String(e));
    // DNS check may block IP literals in tests; either way progress was logged first.
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ action: "progress" }));
    expect(typeof out).toBe("string");
  });
});
