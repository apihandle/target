import { describe, it, expect } from "vitest";
import { detectTask, MAX_TOKENS, PLAYBOOKS, taskModel } from "@/lib/skills";
import { orderCandidates, providers } from "@/lib/llm";
import { redact } from "@/lib/connectors/safety";

describe("task skills", () => {
  it("detects coding, math, writing and research asks", () => {
    expect(detectTask("python me ek script likho jo csv padhe")).toBe("code");
    expect(detectTask("TypeError: cannot read properties of undefined")).toBe("code");
    expect(detectTask("const x = () => 1")).toBe("code");
    expect(detectTask("solve 2x + 5 = 15")).toBe("math");
    expect(detectTask("leave application likh do principal ko")).toBe("writing");
    expect(detectTask("iphone 16 vs pixel 9 compare karo")).toBe("research");
    expect(detectTask("hello kaise ho")).toBe("general");
  });
  it("gives code replies more room and a coding playbook", () => {
    expect(MAX_TOKENS.code).toBeGreaterThan(MAX_TOKENS.general);
    expect(PLAYBOOKS.code).toContain("runnable code");
  });
  it("prefers a coding model on NVIDIA, overridable by CODE_MODEL", () => {
    expect(taskModel("code", { NVIDIA_API_KEY: "x" })).toEqual({ provider: "nvidia", model: "qwen/qwen3-coder-480b-a35b-instruct" });
    expect(taskModel("code", { CODE_MODEL: "openrouter:qwen/qwen3-coder:free" })).toEqual({ provider: "openrouter", model: "qwen/qwen3-coder:free" });
    expect(taskModel("general", { NVIDIA_API_KEY: "x" })).toBeNull();
  });
  it("tries the task model first and keeps the rest as fallback", () => {
    const ps = providers({ NVIDIA_API_KEY: "k" });
    const list = orderCandidates(ps, { provider: "nvidia", model: "qwen/qwen3-coder-480b-a35b-instruct" });
    expect(list[0].model).toBe("qwen/qwen3-coder-480b-a35b-instruct");
    expect(list.length).toBe(ps[0].models.length + 1);
  });
  it("redacts secrets before error reports are stored", () => {
    expect(redact("failed with Bearer sk-abcdefghijklmnopqrstuvwxyz123456")).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });
});
