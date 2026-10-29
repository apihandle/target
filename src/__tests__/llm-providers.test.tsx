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
