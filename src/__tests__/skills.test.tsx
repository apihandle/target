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

import { isMultiTask, MULTI_PLAYBOOK, CAPABILITIES } from "@/lib/skills";
import { looksSecret, parseFacts } from "@/lib/memory";
import { parseProposal } from "@/lib/approvals";

describe("every field", () => {
  it("detects domains", () => {
    expect(detectTask("NEET ke liye biology ka timetable bana do")).toBe("study");
    expect(detectTask("mujhe 3 din se bukhar hai kya karu")).toBe("health");
    expect(detectTask("10000 ki SIP me kitna banega")).toBe("money");
    expect(detectTask("resume improve karo software job ke liye")).toBe("career");
    expect(detectTask("chhoti dukan ki marketing kaise kare")).toBe("business");
    expect(detectTask("rent agreement ke rules kya hain")).toBe("legal");
    expect(detectTask("goa trip plan karo 4 din")).toBe("travel");
    expect(detectTask("paneer butter masala ki recipe")).toBe("cooking");
    expect(PLAYBOOKS.health).toContain("doctor");
  });
  it("spots several asks in one message", () => {
    expect(isMultiTask("1. email likho\n2. ek recipe do\n3. kal ka plan")).toBe(true);
    expect(isMultiTask("weather kya hai? aur news kya hai?")).toBe(true);
    expect(isMultiTask("hello")).toBe(false);
    expect(MULTI_PLAYBOOK).toContain("EVERY");
    expect(CAPABILITIES).toContain("schedule");
  });
  it("memory never keeps secrets", () => {
    expect(looksSecret("My password is abc123")).toBe(true);
    expect(looksSecret("Card 4111 1111 1111 1111")).toBe(true);
    expect(looksSecret("Lives in Patna")).toBe(false);
    expect(parseFacts('["Lives in Patna", "Gmail password is xyz", "Is preparing for NEET"]')).toEqual(["Lives in Patna", "Is preparing for NEET"]);
  });
  it("validates a schedule proposal", () => {
    const ok = parseProposal({ action: "create_schedule", title: "Morning news", prompt: "Top 5 India news", cadence: "daily", time_of_day: "08:00" });
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.value.params.timezone).toBe("Asia/Kolkata"); expect(ok.value.destination).toContain("Scheduled"); }
    expect(parseProposal({ action: "create_schedule", title: "x", prompt: "y", cadence: "weekly", time_of_day: "08:00" }).ok).toBe(false);
  });
});
