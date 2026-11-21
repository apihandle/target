// BloggerBlogPicker on /app/connectors: shows the caller's blogs once Blogger is connected, saves the
// pick through /api/social/blogger, and renders nothing while Blogger isn't connected.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BloggerBlogPicker from "@/components/BloggerBlogPicker";

const BLOGS = [
  { id: "111", name: "Blog One", url: "https://one.example.com/" },
  { id: "222", name: "Blog Two", url: "https://two.example.com/" },
];
const status = (blog: unknown) => ({ connected: true, accountLabel: "user@example.com", blog });

function stubFetch(connected: boolean) {
  const calls: { method: string; body?: unknown }[] = [];
  let current: unknown = null;
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") {
      const id = (calls[calls.length - 1].body as { blogId: string }).blogId;
      const b = BLOGS.find((x) => x.id === id)!;
      current = { blogId: b.id, blogName: b.name, blogUrl: b.url };
      return new Response(JSON.stringify({ status: status(current) }), { status: 200 });
    }
    if (method === "DELETE") { current = null; return new Response(JSON.stringify({ status: status(null) }), { status: 200 }); }
    return new Response(JSON.stringify(connected
      ? { status: status(current), blogs: BLOGS }
      : { status: { connected: false, accountLabel: "", blog: null }, blogs: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("BloggerBlogPicker", () => {
  it("renders nothing when Blogger is not connected", async () => {
    stubFetch(false);
    const { container } = render(<BloggerBlogPicker />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="blogger-picker"]')).toBeNull();
  });

  it("lists the user's blogs and saves the pick", async () => {
    const calls = stubFetch(true);
    const user = userEvent.setup();
    render(<BloggerBlogPicker />);
    const select = await screen.findByTestId("blogger-blog-select");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose a blog…",
      "Blog One — https://one.example.com/",
      "Blog Two — https://two.example.com/",
    ]);
    await user.selectOptions(select, "222");
    await user.click(screen.getByTestId("blogger-blog-save"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ blogId: "222" });
    expect(await screen.findByTestId("blogger-current")).toHaveTextContent("Blog Two");
  });
});
