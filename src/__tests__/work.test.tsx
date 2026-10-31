import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import WorkBoard from "@/components/WorkBoard";
import { cooldownLeft, isHttpsUrl, WORK_COOLDOWN_SEC } from "@/lib/work";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => localStorage.clear());

const LINKS = [{ id: "11111111-1111-4111-8111-111111111111", title: "Ad one", url: "https://ads.example/1", coins: 2 }];
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("work rules", () => {
  it("cooldown is 3 minutes per link", () => {
    const t = Date.parse("2026-10-31T10:00:00Z");
    expect(WORK_COOLDOWN_SEC).toBe(180);
    expect(cooldownLeft(null, t)).toBe(0);
    expect(cooldownLeft("2026-10-31T09:59:00Z", t)).toBe(120);
    expect(cooldownLeft("2026-10-31T09:56:00Z", t)).toBe(0);
  });
  it("only https links are accepted", () => {
    expect(isHttpsUrl("https://ads.example/x")).toBe(true);
    expect(isHttpsUrl("http://ads.example/x")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("Work page", () => {
  it("shows the rules, the links and a log-in prompt when signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ links: LINKS, signedIn: false })));
    render(<WorkBoard />);
    expect(await screen.findByText("Ad one")).toBeInTheDocument();
    expect(screen.getByTestId("work-rules")).toHaveTextContent("no limit");
    expect(screen.getByTestId("work-rules")).toHaveTextContent("3 minutes");
    expect(screen.getByTestId("work-signin")).toBeInTheDocument();
  });

  it("signed in: opening a link starts a view, locks it for 3 minutes, and coming back adds coins", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const started = new Date(Date.now() - 20_000).toISOString();
    const f = vi.fn(async (url: string) => {
      if (url === "/api/work") return res({ links: LINKS, signedIn: true, balance: 5, cooldowns: {} });
      if (url === "/api/work/start") return res({ viewId: "22222222-2222-4222-8222-222222222222", startedAt: started, url: LINKS[0].url, coins: 2 });
      if (url === "/api/work/claim") return res({ coins: 2, balance: 7 });
      return res({}, 404);
    });
    vi.stubGlobal("fetch", f);
    render(<WorkBoard />);
    expect(await screen.findByTestId("work-balance")).toHaveTextContent("5");
    fireEvent.click(screen.getByTestId("work-open"));
    await waitFor(() => expect(tab.location.href).toBe(LINKS[0].url));
    expect(tab.opener).toBeNull();
    expect(screen.getByTestId("work-open")).toBeDisabled();
    expect(screen.getByTestId("work-open")).toHaveTextContent(/Wait [23]:/);
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(screen.getByTestId("work-balance")).toHaveTextContent("7"));
    expect(screen.getByTestId("work-note")).toHaveTextContent("+2 coins");
  });

  it("a link opened too soon shows the wait message and closes the blank tab", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/work"
      ? res({ links: LINKS, signedIn: true, balance: 0, cooldowns: {} })
      : res({ error: "Please wait 2 min before opening this link again", retryAfter: 100 }, 429))));
    render(<WorkBoard />);
    fireEvent.click(await screen.findByTestId("work-open"));
    expect(await screen.findByTestId("work-note")).toHaveTextContent("Please wait 2 min");
    expect(tab.close).toHaveBeenCalled();
  });
});
