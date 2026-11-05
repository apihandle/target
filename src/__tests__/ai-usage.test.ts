// @vitest-environment node
// AI usage logging (migration 0020): fire-and-forget, never throws, never holds prompt/reply text or keys.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ adminThrows: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error("db down");
    return { from: () => ({ insert: () => Promise.reject(new Error("connection refused")) }) };
  },
}));

import { aggregateAiUsage, percentile, type AiRow } from "@/lib/server/adminAiUsage";
import { logAiUsage, sanitizeAiUsage, setAiUsageSink, usageFromSse, withAiUsage, type AiUsageRow } from "@/lib/aiUsage";
import { llm, llmText } from "@/lib/llm";

const SECRET_PROMPT = "my bank password is hunter2-PROMPT";
const REPLY = "Here is the SECRET-REPLY text";
const KEY = "nvapi-SUPERSECRETKEY";

let rows: AiUsageRow[] = [];
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { rows = []; setAiUsageSink((r) => { rows.push(r); }); h.adminThrows = true; });
afterEach(() => { setAiUsageSink(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const sse = (chunks: string[], delays: number[] = []) => new Response(new ReadableStream({
  async start(c) {
    for (let i = 0; i < chunks.length; i++) { if (delays[i]) await new Promise((r) => setTimeout(r, delays[i])); c.enqueue(new TextEncoder().encode(chunks[i])); }
    c.close();
  },
}), { status: 200 });
const word = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const usage = (i: number, o: number) => `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: i, completion_tokens: o } })}\n\ndata: [DONE]\n\n`;
const nim = (models = "m1") => { vi.stubEnv("NVIDIA_API_KEY", KEY); vi.stubEnv("NVIDIA_MODELS", models); vi.stubEnv("OPENROUTER_API_KEY", ""); };

describe("logAiUsage never throws and never blocks", () => {
  it("survives a sink that throws synchronously or rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAiUsageSink(() => { throw new Error("boom"); });
    expect(() => logAiUsage({ provider: "nim", model: "m", success: true })).not.toThrow();
    setAiUsageSink(() => Promise.reject(new Error("db down")));
    expect(logAiUsage({ provider: "nim", model: "m", success: true })).toBeUndefined();
    await flush();
    expect(warn).toHaveBeenCalled();
  });

  it("returns at once even when the insert would hang forever", () => {
    setAiUsageSink(() => new Promise(() => undefined));
    const t = Date.now();
    logAiUsage({ provider: "nim", model: "m", success: true });
    expect(Date.now() - t).toBeLessThan(20);
  });

  it("default sink: database down / service role missing → no throw, no unhandled rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    setAiUsageSink(null);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "srv"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://p.supabase.co");
    h.adminThrows = true;
    expect(() => logAiUsage({ provider: "nim", model: "m", success: true })).not.toThrow();
    h.adminThrows = false; // client builds, insert rejects
    expect(() => logAiUsage({ provider: "openrouter", model: "m", success: false, error_code: "http_500" })).not.toThrow();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => logAiUsage({ provider: "custom", model: "m", success: true })).not.toThrow();
    await flush(); await flush();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("whitelists fields: prompt/messages/keys/unknown keys are dropped, bad values nulled", () => {
    const row = sanitizeAiUsage({ provider: "nvidia", model: "m", success: true, user_id: "not-a-uuid", feature: "Bad Feature!", error_code: "HTTP 429",
      ...({ prompt: SECRET_PROMPT, messages: [{ content: SECRET_PROMPT }], key: KEY, response: REPLY } as object) } as never)!;
    expect(Object.keys(row).sort()).toEqual(["attempt", "error_code", "feature", "input_tokens", "latency_ms", "model", "output_tokens", "provider", "race_won", "request_id", "streamed", "success", "ttft_ms", "user_id"].sort());
    expect(JSON.stringify(row)).not.toMatch(/hunter2|SECRET-REPLY|SUPERSECRET/);
    expect(row).toMatchObject({ provider: "nim", user_id: null, feature: "other", error_code: "http_429" });
    expect(sanitizeAiUsage({ provider: "acme", model: "m" })).toBeNull();
  });

  it("parses token counts from SSE usage chunks", () => {
    expect(usageFromSse(word("hi") + usage(12, 34))).toEqual({ input: 12, output: 34 });
    expect(usageFromSse(word("hi"))).toBeNull();
  });
});

describe("llm() logs every attempt from the central call path", () => {
  it("streaming winner: provider, model, feature, user, ttft, latency, tokens — and no prompt, reply or key", async () => {
    nim();
    vi.stubGlobal("fetch", vi.fn(async () => sse([word(REPLY), usage(10, 5)])));
    const uid = "11111111-1111-4111-8111-111111111111";
    const r = await llm({ messages: [{ role: "user", content: SECRET_PROMPT }], stream: true, usage: { userId: uid, feature: "chat" } });
    expect(await r.text()).toContain("SECRET-REPLY");
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "nim", model: "m1", feature: "chat", user_id: uid, success: true, streamed: true, input_tokens: 10, output_tokens: 5, race_won: null, error_code: null });
    expect(rows[0].ttft_ms).not.toBeNull();
    expect(rows[0].latency_ms).not.toBeNull();
    expect(JSON.stringify(rows)).not.toMatch(/hunter2|SECRET-REPLY|SUPERSECRET/);
  });

  it("race: winner race_won=true, slow model logged as cancelled (race_won=false), same request_id", async () => {
    nim("slow,quick");
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const m = JSON.parse(String(init.body)).model;
      return m === "slow" ? sse([word("late")], [3000]) : sse([word("Hello")]);
    }));
    const r = await llm({ messages: [], stream: true, firstTokenMs: 30 });
    await r.text();
    await flush();
    const won = rows.find((x) => x.model === "quick")!;
    const lost = rows.find((x) => x.model === "slow")!;
    expect(won).toMatchObject({ success: true, race_won: true });
    expect(lost).toMatchObject({ success: false, error_code: "cancelled", race_won: false });
    expect(won.request_id).toBe(lost.request_id);
    expect(won.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("failed attempt is logged with its HTTP code, the fallback with success (non-streaming tokens from JSON)", async () => {
    nim("a,b");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("rl", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 })));
    expect(await withAiUsage({ feature: "memory" }, () => llmText({ messages: [{ role: "user", content: SECRET_PROMPT }] }))).toBe("hi");
    await flush();
    expect(rows.map((x) => [x.model, x.success, x.error_code, x.feature])).toEqual([["a", false, "http_429", "memory"], ["b", true, null, "memory"]]);
    expect(rows[1]).toMatchObject({ input_tokens: 3, output_tokens: 1, streamed: false, race_won: true });
  });

  it("chat keeps working when the usage insert fails (database down)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAiUsageSink(() => Promise.reject(new Error("db down")));
    nim();
    vi.stubGlobal("fetch", vi.fn(async () => sse([word("Hi"), word(" there")])));
    const r = await llm({ messages: [], stream: true });
    const text = await r.text();
    expect(text).toContain('"Hi"');
    expect(text).toContain('" there"');
  });

  it("custom provider: logged as 'custom' + model id only, never its name, URL or key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([word("yo")])));
    const r = await llm({ messages: [{ role: "user", content: SECRET_PROMPT }], stream: true, custom: { name: "My Secret Lab", url: "https://lab.example.com/v1/chat/completions", key: "sk-CUSTOMKEY", model: "llama-x" }, usage: { feature: "chat" } });
    await r.text();
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "custom", model: "llama-x", success: true, race_won: null });
    expect(JSON.stringify(rows)).not.toMatch(/Secret Lab|lab\.example|CUSTOMKEY|hunter2/);
  });

  it("custom provider failure → success=false with the code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(llm({ messages: [], custom: { name: "X", url: "https://x.test/v1/chat/completions", key: "k", model: "m" } })).rejects.toThrow();
    await flush();
    expect(rows[0]).toMatchObject({ provider: "custom", success: false, error_code: "http_401" });
  });

  it("withAiUsage attaches the user to calls made inside it (explicit usage wins for the feature)", async () => {
    nim();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })));
    const uid = "22222222-2222-4222-8222-222222222222";
    await withAiUsage({ userId: uid, feature: "browser" }, async () => { await new Promise((r) => setTimeout(r, 1)); await llmText({ messages: [], usage: { feature: "research" } }); });
    await flush();
    expect(rows[0]).toMatchObject({ user_id: uid, feature: "research" });
  });
});

describe("admin aggregation", () => {
  const now = Date.parse("2026-11-05T06:00:00Z");
  const at = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const base = { user_id: null, input_tokens: null, output_tokens: null, ttft_ms: null, race_won: null, error_code: null, feature: "chat" };
  const U = "33333333-3333-4333-8333-333333333333";
  const rowsIn: AiRow[] = [
    { ...base, created_at: at(10), request_id: "r1", provider: "nim", model: "ultra", latency_ms: 1000, ttft_ms: 300, success: true, race_won: true, user_id: U },
    { ...base, created_at: at(10), request_id: "r1", provider: "nim", model: "mistral", latency_ms: 900, success: false, error_code: "cancelled", race_won: false, user_id: U },
    { ...base, created_at: at(20), request_id: "r2", provider: "openrouter", model: "free", latency_ms: 3000, success: true, user_id: U },
    { ...base, created_at: at(30), request_id: "r3", provider: "nim", model: "ultra", latency_ms: 200, success: false, error_code: "http_429" },
    { ...base, created_at: at(60 * 30), request_id: "old", provider: "nim", model: "ultra", latency_ms: 1, success: true },
  ];
  it("counts requests (not attempts), failure rate, splits by the model that answered, latency p95", () => {
    const a = aggregateAiUsage(rowsIn, "24h", now);
    expect(a.requests).toBe(3);
    expect(a.attempts).toBe(4);
    expect(a.failedRequests).toBe(1);
    expect(a.failureRate).toBeCloseTo(1 / 3);
    expect(a.cancelled).toBe(1);
    expect(a.attemptErrors).toBe(1);
    expect(a.racesWon).toBe(1);
    expect(a.models.map((m) => [m.key, m.count, m.failed])).toEqual([["ultra", 1, 1], ["free", 1, 0]]);
    expect(a.providers.find((p) => p.key === "nim")).toMatchObject({ count: 1, pct: 50 });
    expect(a.latency).toEqual({ avg: 2000, p95: 3000 });
    expect(a.ttft).toEqual({ avg: 300, p95: 300 });
    expect(a.userCounts.get(U)).toBe(2);
    expect(a.series.reduce((x, b) => x + b.requests, 0)).toBe(3);
  });
  it("percentile (nearest rank)", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });
});
