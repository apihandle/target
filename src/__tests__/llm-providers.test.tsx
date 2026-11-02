import { describe, it, expect, vi, afterEach } from "vitest";
import { providers, llm, llmText } from "@/lib/llm";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("LLM provider chain", () => {
  it("orders NVIDIA before OpenRouter", () => {
    expect(providers({ NVIDIA_API_KEY: "n", OPENROUTER_API_KEY: "o" }).map((p) => p.name)).toEqual(["nvidia", "openrouter"]);
    expect(providers({ OPENROUTER_API_KEY: "o" }).map((p) => p.name)).toEqual(["openrouter"]);
  });

  it("falls through failing models to the next one", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "n"); vi.stubEnv("NVIDIA_MODELS", "a,b"); vi.stubEnv("OPENROUTER_API_KEY", "");
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await llmText({ messages: [{ role: "user", content: "x" }] })).toBe("hi");
    expect(JSON.parse(f.mock.calls[1][1].body).model).toBe("b");
  });

  it("reports quota exhaustion as 429", async () => {
    vi.stubEnv("NVIDIA_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rl", { status: 429 })));
    await expect(llm({ messages: [] })).rejects.toMatchObject({ status: 429 });
  });
});

const sseRes = (chunks: string[], delays: number[] = []) => new Response(new ReadableStream({
  async start(c) {
    for (let i = 0; i < chunks.length; i++) { if (delays[i]) await new Promise((r) => setTimeout(r, delays[i])); c.enqueue(new TextEncoder().encode(chunks[i])); }
    c.close();
  },
}), { status: 200 });
const word = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const thinking = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] })}\n\n`;

describe("fast first word", () => {
  it("detects the first visible word, not thinking", async () => {
    const { sseHasAnswer } = await import("@/lib/llm");
    expect(sseHasAnswer(thinking)).toBeNull();
    expect(sseHasAnswer(thinking + word("Hi"))).toBe("answer");
    expect(sseHasAnswer("data: [DONE]\n")).toBe("empty");
  });

  it("races the next model when the first is slow to start, and keeps the full reply", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "n"); vi.stubEnv("NVIDIA_MODELS", "slow,quick"); vi.stubEnv("OPENROUTER_API_KEY", "");
    const aborted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const m = JSON.parse(String(init.body)).model;
      init.signal?.addEventListener("abort", () => aborted.push(m));
      return m === "slow" ? sseRes([thinking, word("late")], [0, 2000]) : sseRes([word("Hello"), word(" there")]);
    }));
    const t = Date.now();
    const r = await llm({ messages: [], stream: true, firstTokenMs: 50 });
    const text = await r.text();
    expect(Date.now() - t).toBeLessThan(1500);
    expect(text).toContain('"Hello"');
    expect(text).toContain('" there"');
    expect(aborted).toContain("slow");
  });

  it("an empty stream falls through to the next model", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "n"); vi.stubEnv("NVIDIA_MODELS", "a,b"); vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => JSON.parse(String(init.body)).model === "a" ? sseRes([thinking, "data: [DONE]\n\n"]) : sseRes([word("ok")])));
    expect(await (await llm({ messages: [], stream: true })).text()).toContain('"ok"');
  });

  it("gives up when no model starts before the deadline", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "n"); vi.stubEnv("NVIDIA_MODELS", "a"); vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))));
    await expect(llm({ messages: [], stream: true, timeoutMs: 100 })).rejects.toMatchObject({ status: 502 });
  });
});

describe("quick turns", () => {
  it("small talk and short questions are quick; tool and real-work asks are not", async () => {
    const { isQuickTurn } = await import("@/lib/quick");
    expect(isQuickTurn("hi")).toBe(true);
    expect(isQuickTurn("Chai aur coffee mein kaun zyada healthy hai? Short mein batao.")).toBe(true);
    expect(isQuickTurn("Ek bar chart bana do: Mon 3, Tue 5")).toBe(false);
    expect(isQuickTurn("timebucks.com pe login karo")).toBe(false);
    expect(isQuickTurn("mera gmail check karo")).toBe(false);
    expect(isQuickTurn("aaj ka weather kya hai")).toBe(false);
    expect(isQuickTurn("Write a Python script to rename files")).toBe(false);
    expect(isQuickTurn("hi", { hasAttachments: true })).toBe(false);
    expect(isQuickTurn("x".repeat(200))).toBe(false);
  });
});
