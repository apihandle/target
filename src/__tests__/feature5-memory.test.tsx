import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import MemoryManager from "@/components/MemoryManager";
import { explicitRemember, isDuplicate, parseFacts, memoryBlock, cleanFact } from "@/lib/memory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

describe("Feature 5: memory", () => {
  it("detects explicit remember requests in English and Hinglish", () => {
    expect(explicitRemember("Remember that I am vegetarian")).toBe("I am vegetarian");
    expect(explicitRemember("yaad rakhna ki meri bike ka number BR01 hai")).toBe("meri bike ka number BR01 hai");
    expect(explicitRemember("mera birthday 2 Jan hai, yaad rakhna")).toBe("mera birthday 2 Jan hai");
    expect(explicitRemember("what is the weather")).toBeNull();
    expect(explicitRemember("remember")).toBeNull();
  });

  it("dedupes by normalized text", () => {
    expect(isDuplicate("Lives in Patna.", ["lives in patna"])).toBe(true);
    expect(isDuplicate("Likes cricket", ["Lives in Patna"])).toBe(false);
    expect(isDuplicate("Works as a developer at home", ["Works as a developer"])).toBe(true);
  });

  it("parses extractor output robustly", () => {
    expect(parseFacts('```json\n["Lives in Patna", "Likes tea"]\n```')).toEqual(["Lives in Patna", "Likes tea"]);
    expect(parseFacts("[]")).toEqual([]);
    expect(parseFacts("nothing here")).toEqual([]);
    expect(parseFacts('["a","b","c","d","e"]'.replace(/"(\w)"/g, '"fact $1"')).length).toBe(3);
    expect(cleanFact('  "- Likes tea"  ')).toBe("Likes tea");
  });

  it("builds a memory block for the system prompt", () => {
    expect(memoryBlock([])).toBe("");
    expect(memoryBlock(["Lives in Patna"])).toContain("- Lives in Patna");
  });

  it("lists, adds and deletes memories", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ memory: { id: "2", content: "Likes tea", source: "manual" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryManager initial={[{ id: "1", content: "Lives in Patna", source: "chat" }]} />);
    expect(screen.getAllByTestId("memory-item")).toHaveLength(1);
    expect(screen.getByText("learned in chat")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("memory-input"), { target: { value: "Likes tea" } });
    fireEvent.click(screen.getByTestId("memory-add"));
    await waitFor(() => expect(screen.getAllByTestId("memory-item")).toHaveLength(2));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content: "Likes tea" });
    fireEvent.click(screen.getAllByTestId("memory-delete")[1]);
    await waitFor(() => expect(screen.getAllByTestId("memory-item")).toHaveLength(1));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/memories/1");
  });

  it("shows server errors (duplicate)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Already remembered" }), { status: 409 })));
    render(<MemoryManager initial={[]} />);
    fireEvent.change(screen.getByTestId("memory-input"), { target: { value: "x y" } });
    fireEvent.click(screen.getByTestId("memory-add"));
    await waitFor(() => expect(screen.getByTestId("memory-error")).toHaveTextContent("Already remembered"));
  });
});
