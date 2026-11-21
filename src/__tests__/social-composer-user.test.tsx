// The /app/social composer (SocialComposer with apiBase="/api/social"): destination chips reflect
// the signed-in user's OWN connections (their Page name as the hint, per-target not-ready reasons),
// and publishing goes to the user routes — never the admin ones.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SocialComposer, { type SocialStatus } from "@/components/admin/SocialComposer";

const STATUS: SocialStatus = {
  meta: { vars: [], pageId: "111", igUserId: null, graphVersion: "v21.0" },
  targets: {
    facebook: { ready: true },
    instagram: { ready: false, reason: "No Instagram account is linked to that Page" },
    blogger: { ready: false, reason: "Blogger is not connected" },
  },
  gemini: { saved: true, preview: "AIza…fixture", model: null },
  blogger: {
    vars: [{ name: "BLOGGER_OAUTH_CLIENT_ID", set: true }, { name: "BLOGGER_OAUTH_CLIENT_SECRET", set: true }],
    oauthConfigured: true,
    connected: false,
    accountLabel: "",
    blog: null,
  },
};

function stubFetch() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const u = String(url);
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u === "/api/social/schedule" && method === "GET") return new Response(JSON.stringify({ posts: [] }), { status: 200 });
    if (u === "/api/social/publish") return new Response(JSON.stringify({ results: [{ target: "facebook", ok: true, id: "post-1", url: "https://www.facebook.com/post-1" }] }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("user composer", () => {
  it("chips show the user's own Page hint and the per-target not-ready reasons", async () => {
    stubFetch();
    render(
      <SocialComposer
        initial={STATUS}
        apiBase="/api/social"
        confirmNote="It posts only to the accounts you connected."
        targetHints={{ facebook: "Your Page · My Page" }}
        defaultTargets={["facebook"]}
      />,
    );
    expect(screen.getByTestId("social-target-facebook")).toBeChecked();
    expect(screen.getByText("Your Page · My Page")).toBeTruthy();
    expect(screen.getByText(/Not set up: No Instagram account is linked to that Page/)).toBeTruthy();
    expect(screen.getByText(/Not set up: Blogger is not connected/)).toBeTruthy();
  });

  it("publishing posts to /api/social/publish (never the admin routes) and shows the result", async () => {
    const calls = stubFetch();
    render(
      <SocialComposer
        initial={STATUS}
        apiBase="/api/social"
        confirmNote="It posts only to the accounts you connected."
        targetHints={{ facebook: "Your Page · My Page" }}
        defaultTargets={["facebook"]}
      />,
    );
    await userEvent.type(screen.getByTestId("social-message"), "Hello from my Page");
    await userEvent.click(screen.getByTestId("social-publish"));
    expect(screen.getByText(/It posts only to the accounts you connected\./)).toBeTruthy();
    await userEvent.click(screen.getByTestId("social-publish-confirm"));
    await waitFor(() => expect(screen.getByTestId("social-results")).toHaveTextContent("Published"));
    const pub = calls.find((c) => c.url === "/api/social/publish")!;
    expect(pub.body).toMatchObject({ message: "Hello from my Page", targets: ["facebook"] });
    expect(calls.some((c) => c.url.startsWith("/api/admin/"))).toBe(false);
  });
});
