// MetaPagePicker + GeminiKeyCard + NvidiaKeyCard on /app/connectors: the picker shows the caller's
// Pages once Meta is connected, saves the pick through /api/social/meta, and renders nothing while
// Meta isn't connected; the key cards test/save/clear the caller's own keys through /api/social/key
// (the NVIDIA card passes provider: "nvidia" — it is the social writer's preferred key).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MetaPagePicker from "@/components/MetaPagePicker";
import GeminiKeyCard from "@/components/GeminiKeyCard";
import NvidiaKeyCard from "@/components/NvidiaKeyCard";

const PAGES = [
  { id: "111", name: "Page One", instagram: { id: "ig-1", username: "pageone" } },
  { id: "222", name: "Page Two", instagram: null },
];
const metaStatus = (page: unknown) => ({ connected: true, accountLabel: "Test Person", page, instagram: page ? { id: "ig-1", username: "pageone" } : null });

function stubMetaFetch(connected: boolean) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let current: unknown = null;
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") {
      const id = (calls[calls.length - 1].body as { pageId: string }).pageId;
      const p = PAGES.find((x) => x.id === id)!;
      current = { id: p.id, name: p.name };
      return new Response(JSON.stringify({ status: metaStatus(current) }), { status: 200 });
    }
    if (method === "DELETE") { current = null; return new Response(JSON.stringify({ status: metaStatus(null) }), { status: 200 }); }
    return new Response(JSON.stringify(connected
      ? { status: metaStatus(current), pages: PAGES }
      : { status: { connected: false, accountLabel: "", page: null, instagram: null }, pages: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("MetaPagePicker", () => {
  it("renders nothing when Meta is not connected", async () => {
    stubMetaFetch(false);
    const { container } = render(<MetaPagePicker />);
    await waitFor(() => expect(container.querySelector("[data-testid='meta-picker']")).toBeNull());
    expect(screen.queryByTestId("meta-picker")).toBeNull();
  });

  it("lists the user's Pages with their Instagram link and saves the pick", async () => {
    const calls = stubMetaFetch(true);
    render(<MetaPagePicker />);
    const select = await screen.findByTestId("meta-page-select");
    expect(select).toHaveTextContent("Page One");
    expect(select).toHaveTextContent("Instagram @pageone");
    expect(select).toHaveTextContent("no Instagram linked");
    await userEvent.selectOptions(select, "111");
    await userEvent.click(screen.getByTestId("meta-page-save"));
    await waitFor(() => expect(screen.getByTestId("meta-current")).toHaveTextContent("Page One"));
    expect(screen.getByTestId("meta-current")).toHaveTextContent("@pageone");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/social/meta");
    expect(post.body).toEqual({ pageId: "111" });
  });

  it("clearing forgets the choice through DELETE", async () => {
    const calls = stubMetaFetch(true);
    render(<MetaPagePicker />);
    const select = await screen.findByTestId("meta-page-select");
    await userEvent.selectOptions(select, "111");
    await userEvent.click(screen.getByTestId("meta-page-save"));
    await waitFor(() => expect(screen.getByTestId("meta-current")).toBeTruthy());
    await userEvent.click(screen.getByTestId("meta-page-clear"));
    await waitFor(() => expect(screen.queryByTestId("meta-current")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/social/meta")).toBe(true);
  });
});

describe("GeminiKeyCard", () => {
  function stubKeyFetch() {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    let saved = false;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const u = String(url);
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === "/api/social/key/test") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (u === "/api/social/key" && method === "POST") { saved = true; return new Response(JSON.stringify({ gemini: { saved: true, preview: "AIza…fixture", model: null } }), { status: 200 }); }
      if (u === "/api/social/key" && method === "DELETE") { saved = false; return new Response(JSON.stringify({ gemini: { saved: false, preview: "", model: null } }), { status: 200 }); }
      return new Response(JSON.stringify({ gemini: saved ? { saved: true, preview: "AIza…fixture", model: null } : { saved: false, preview: "", model: null } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    return calls;
  }

  it("test → save → clear flow, all through the user key routes", async () => {
    const calls = stubKeyFetch();
    render(<GeminiKeyCard />);
    const input = await screen.findByTestId("gemini-key-input");
    await userEvent.type(input, "gemini-key-fixture");
    await userEvent.click(screen.getByTestId("gemini-key-test"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Google accepts this key"));
    expect(calls.find((c) => c.url === "/api/social/key/test")?.body).toEqual({ apiKey: "gemini-key-fixture" });

    await userEvent.click(screen.getByTestId("gemini-key-save"));
    await waitFor(() => expect(screen.getByText(/Saved ·/)).toBeTruthy());
    expect(calls.some((c) => c.url === "/api/social/key" && c.method === "POST")).toBe(true);

    await userEvent.click(screen.getByTestId("gemini-key-clear"));
    await userEvent.click(screen.getByTestId("gemini-key-clear-confirm"));
    await waitFor(() => expect(screen.getByText("Not saved")).toBeTruthy());
    expect(calls.some((c) => c.url === "/api/social/key" && c.method === "DELETE")).toBe(true);
  });
});

describe("NvidiaKeyCard", () => {
  function stubKeyFetch() {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    let saved = false;
    const status = () => ({ saved, preview: saved ? "nvapi…fixture" : "", model: null });
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const u = String(url);
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === "/api/social/key/test") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (u === "/api/social/key" && method === "POST") { saved = true; return new Response(JSON.stringify({ gemini: { saved: false, preview: "", model: null }, nvidia: status() }), { status: 200 }); }
      if (u.startsWith("/api/social/key") && method === "DELETE") { saved = false; return new Response(JSON.stringify({ gemini: { saved: false, preview: "", model: null }, nvidia: status() }), { status: 200 }); }
      return new Response(JSON.stringify({ gemini: { saved: false, preview: "", model: null }, nvidia: status() }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    return calls;
  }

  it("test → save → clear flow, always with provider nvidia", async () => {
    const calls = stubKeyFetch();
    render(<NvidiaKeyCard />);
    const input = await screen.findByTestId("nvidia-key-input");
    await userEvent.type(input, "nvidia-key-fixture");
    await userEvent.click(screen.getByTestId("nvidia-key-test"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("NVIDIA accepts this key"));
    expect(calls.find((c) => c.url === "/api/social/key/test")?.body).toEqual({ provider: "nvidia", apiKey: "nvidia-key-fixture" });

    await userEvent.click(screen.getByTestId("nvidia-key-save"));
    await waitFor(() => expect(screen.getByText(/Saved ·/)).toBeTruthy());
    const save = calls.find((c) => c.url === "/api/social/key" && c.method === "POST");
    expect(save?.body).toMatchObject({ provider: "nvidia", apiKey: "nvidia-key-fixture" });

    await userEvent.click(screen.getByTestId("nvidia-key-clear"));
    await userEvent.click(screen.getByTestId("nvidia-key-clear-confirm"));
    await waitFor(() => expect(screen.getByText("Not saved")).toBeTruthy());
    expect(calls.some((c) => c.url === "/api/social/key?provider=nvidia" && c.method === "DELETE")).toBe(true);
  });
});
