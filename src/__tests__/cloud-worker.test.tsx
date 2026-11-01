import { describe, it, expect, vi, afterEach } from "vitest";
import { configuredProviders, startSession, redact } from "@/lib/server/remoteBrowser";
import { safeUrl } from "@/lib/server/cloudWorker";

afterEach(() => vi.restoreAllMocks());

describe("cloud browser providers", () => {
  it("lists only configured providers, in default order", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ ANCHOR_API_KEY: "a", STEEL_API_KEY: "s", BROWSERBASE_API_KEY: "b" })).toEqual(["steel", "anchor"]);
    expect(configuredProviders({ BROWSERBASE_API_KEY: "b", BROWSERBASE_PROJECT_ID: "p", BROWSERLESS_TOKEN: "t" })).toEqual(["browserless", "browserbase"]);
  });
  it("honours a custom order", () => {
    expect(configuredProviders({ STEEL_API_KEY: "s", HYPERBROWSER_API_KEY: "h", BROWSER_PROVIDERS: "hyperbrowser,steel" })).toEqual(["hyperbrowser", "steel"]);
  });
  it("builds CDP urls for token providers without network", async () => {
    expect((await startSession("steel", { STEEL_API_KEY: "k1" })).wsUrl).toBe("wss://connect.steel.dev?apiKey=k1");
    expect((await startSession("browserless", { BROWSERLESS_TOKEN: "k2" })).wsUrl).toBe("wss://production-sfo.browserless.io?token=k2");
  });
  it("creates a Hyperbrowser session over REST", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "s1", wsEndpoint: "wss://x/s1" }), { status: 200 }));
    const s = await startSession("hyperbrowser", { HYPERBROWSER_API_KEY: "h" });
    expect(s.wsUrl).toBe("wss://x/s1");
    expect(String(f.mock.calls[0][0])).toContain("api.hyperbrowser.ai/api/session");
  });
  it("redacts keys from errors", () => {
    expect(redact("wss://connect.steel.dev?apiKey=SECRET123 failed")).toBe("wss://connect.steel.dev?apiKey=*** failed");
    expect(redact("x?token=abc&y=1")).toBe("x?token=***&y=1");
  });
  it("blocks private addresses", () => {
    expect(() => safeUrl("http://127.0.0.1/")).toThrow();
    expect(() => safeUrl("file:///etc/passwd")).toThrow();
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
  });
});
