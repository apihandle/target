import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { splitBlocks, sanitizeBlock } from "@/lib/blocks";
import Blocks from "@/components/Blocks";
import SourceList from "@/components/SourceList";

const fence = (o: unknown) => "Here you go.\n\n```blocks\n" + JSON.stringify(o) + "\n```";

describe("rich blocks parsing", () => {
  it("extracts sanitized cards and hides the fence", () => {
    const { text, blocks } = splitBlocks(fence([
      { type: "links", items: [{ title: "A", url: "https://a.com/x" }, { title: "bad", url: "javascript:alert(1)" }] },
      { type: "table", columns: ["Name", "Price", "Link"], rows: [["x", "$1", "https://x.com"]] },
      { type: "nope" },
    ]));
    expect(text).toBe("Here you go.");
    expect(blocks.map((b) => b.type)).toEqual(["links", "table"]);
    expect(blocks[0].type === "links" && blocks[0].items).toHaveLength(1);
  });
  it("falls back to markdown on malformed JSON and hides a half-streamed fence", () => {
    expect(splitBlocks("hi\n```blocks\n[{oops```").blocks).toEqual([]);
    const half = splitBlocks('Answer\n```blocks\n[{"type":"links"');
    expect(half.text).toBe("Answer");
    expect(half.blocks).toEqual([]);
  });
  it("rejects non-https images, invalid calendar dates, empty drafts", () => {
    expect(sanitizeBlock({ type: "images", items: [{ url: "http://a.com/x.png" }] })).toBeNull();
    expect(sanitizeBlock({ type: "calendar", title: "t", start: "not a date" })).toBeNull();
    expect(sanitizeBlock({ type: "draft", body: "  " })).toBeNull();
  });
});

describe("rich blocks rendering", () => {
  it("renders every card type", () => {
    const { blocks } = splitBlocks(fence([
      { type: "links", items: [{ title: "Site", url: "https://site.com", description: "d" }] },
      { type: "table", title: "Compare", columns: ["A", "B"], rows: [["1", "2"]] },
      { type: "images", items: [{ url: "https://img.com/a.png", caption: "cap" }] },
      { type: "summary", title: "Plan", markdown: "**bold**" },
      { type: "draft", title: "Email", body: "Hello" },
      { type: "code", language: "python", source: "print(1)" },
      { type: "calendar", title: "Meet", start: "2026-11-05T10:00:00+05:30" },
      { type: "order", merchant: "Shop", items: [{ name: "Tea", price: "$3" }], total: "$3" },
    ]));
    render(<Blocks blocks={blocks} />);
    for (const id of ["block-links", "block-table", "block-images", "block-summary", "block-draft", "block-code", "block-calendar", "block-order"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByText(/never pays/i)).toBeTruthy();
    expect(screen.getByText("site.com")).toBeTruthy();
  });
  it("shows search sources as link cards with favicons", () => {
    const { container } = render(<SourceList sources={[{ title: "News", url: "https://news.com/a" }]} />);
    expect(screen.getByTestId("sources")).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("news.com");
  });
});
