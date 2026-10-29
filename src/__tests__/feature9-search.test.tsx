import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import Chat from "@/components/Chat";
import { needsSearch, searchQuery, splitSources, sourcesFence, searchBlock, tavilySearch } from "@/lib/search";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const res = { answer: "Ans", results: [{ title: "Story", url: "https://news.example.com/a", content: "Body" }, { title: "Two", url: "https://www.two.org/b", content: "B" }] };

describe("Feature 9: web search", () => {
  it("decides when a message needs the web", () => {
    expect(needsSearch("latest news on ISRO")).toBe(true);
    expect(needsSearch("aaj Patna ka mausam kaisa hai? weather")).toBe(true);
    expect(needsSearch("/search best pizza in Patna")).toBe(true);
    expect(needsSearch("who won the 2026 world cup")).toBe(true);
    expect(needsSearch("hi")).toBe(false);
    expect(needsSearch("Draft a polite email asking for a deadline extension")).toBe(false);
    expect(needsSearch("yaad rakhna mujhe chai pasand hai")).toBe(false);
  });

  it("strips the explicit prefix from the query", () => {
    expect(searchQuery("/search  best   pizza")).toBe("best pizza");
  });

  it("calls Tavily with a bearer key and keeps only http results", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: "A", results: [...res.results, { title: "bad", url: "javascript:x" }] })));
    const r = await tavilySearch("q", "k", f as unknown as typeof fetch);
    expect(r.results).toHaveLength(2);
    const [, init] = f.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).query).toBe("q");
  });

  it("builds the prompt block and round-trips sources", () => {
    expect(searchBlock("q", res)).toContain("[1] Story (https://news.example.com/a)");
    const r = splitSources("Answer [1]." + sourcesFence(res));
    expect(r.text).toBe("Answer [1].");
    expect(r.sources.map((s) => s.url)).toEqual(["https://news.example.com/a", "https://www.two.org/b"]);
    expect(splitSources('x\n```sources\n[{"url":"javascript:1"}]```').sources).toEqual([]);
    expect(splitSources('x\n```sources\n[{"ur').text).toBe("x");
  });

  it("sends web:true from the toggle and renders source chips", async () => {
    const enc = new TextEncoder();
    const f = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("Fresh answer [1]." + sourcesFence(res))); c.close(); } })));
    vi.stubGlobal("fetch", f);
    render(<Chat />);
    fireEvent.click(screen.getByTestId("web-toggle"));
    expect(screen.getByTestId("web-toggle").getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "ISRO news" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(screen.getByTestId("sources")).toBeTruthy());
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ message: "ISRO news", web: true });
    expect(screen.getByText("[2] two.org")).toBeTruthy();
    expect(screen.queryByText(/```sources/)).toBeNull();
  });
});
