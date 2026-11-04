/**
 * Multi-step tasks end in an answer: when the tool rounds or the time budget run out, the agent asks the model once
 * more WITHOUT tools to answer from what it gathered (found live: "read the top 5 HN posts" stopped after 8 page reads
 * with "I stopped after several tool steps" and no summary).
 */
import { describe, it, expect, vi } from "vitest";
import { flattenTools, MAX_CALLS_PER_ROUND, MAX_ROUNDS, runAgent, WRAP_UP } from "@/lib/agent";
import type { LLMMessage } from "@/lib/llm";
import { pickPlaybooks } from "@/lib/playbooks";

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const call = (i: number) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${i}`, function: { name: "target__read_webpage", arguments: `{"url":"https://news.ycombinator.com/item?id=${i}"}` } }] } }] }]);
const text = (t: string) => sse([{ choices: [{ delta: { content: t } }] }]);
const onTool = vi.fn(async () => ({ kind: "result" as const, content: "<untrusted_data>post text</untrusted_data>", connector: "target", tool: "read_webpage" }));

describe("agent wrap-up", () => {
  it("allows more steps per task than before", () => {
    expect(MAX_ROUNDS).toBeGreaterThanOrEqual(8);
    expect(MAX_CALLS_PER_ROUND).toBeGreaterThanOrEqual(6);
  });

  it("out of rounds: one more request without tools turns the gathered pages into the answer", async () => {
    let n = 0;
    const next = vi.fn(async () => call(++n));
    const final = vi.fn(async (msgs: LLMMessage[]) => {
      expect(msgs.at(-1)).toEqual({ role: "user", content: WRAP_UP });
      expect(msgs.some((m) => m.role === "tool")).toBe(false); // flattened for providers that refuse tool turns without tools
      return text("1. Post one: ...\n2. Post two: ...");
    });
    const out: string[] = [];
    const r = await runAgent({ messages: [{ role: "user", content: "read the top 5 HN posts and summarise each" }], first: call(0), next, final, onText: (s) => out.push(s), onTool, cancelled: () => false, maxRounds: 3 });
    expect(final).toHaveBeenCalledTimes(1);
    expect(r.hitLimit).toBe(false);
    expect(r.text).toMatch(/1\. Post one/);
    expect(out.join("")).toMatch(/2\. Post two/);
  });

  it("past the deadline: stops starting tool rounds and wraps up", async () => {
    const next = vi.fn(async () => call(9));
    const final = vi.fn(async () => text("Here is what I found so far."));
    const r = await runAgent({ messages: [{ role: "user", content: "x" }], first: call(1), next, final, onText: () => undefined, onTool, cancelled: () => false, deadline: Date.now() - 1 });
    expect(next).not.toHaveBeenCalled();
    expect(final).toHaveBeenCalledTimes(1);
    expect(r.text).toMatch(/what I found/);
    expect(r.hitLimit).toBe(false);
  });

  it("without a final step it still reports the limit (old behaviour)", async () => {
    const r = await runAgent({ messages: [], first: call(1), next: async () => call(2), onText: () => undefined, onTool, cancelled: () => false, maxRounds: 2 });
    expect(r.hitLimit).toBe(true);
  });

  it("a model that answers in text never triggers the wrap-up", async () => {
    const final = vi.fn();
    const r = await runAgent({ messages: [], first: text("done"), next: vi.fn(), final, onText: () => undefined, onTool, cancelled: () => false });
    expect(final).not.toHaveBeenCalled();
    expect(r.text).toBe("done");
  });

  it("flattens tool calls and results into plain turns", () => {
    const flat = flattenTools([
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "target__read_webpage", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "page" },
    ]);
    expect(flat[1]).toEqual({ role: "assistant", content: "(Used tools: read_webpage)" });
    expect(flat[2]).toEqual({ role: "user", content: "Tool result (read_webpage):\npage" });
  });
});

describe("reminders", () => {
  it("the scheduling playbook sets reminders with the schedule card, not a file", () => {
    const g = pickPlaybooks("plan my week: remind me every Monday 9am to check emails").map((p) => p.guidance).join("\n");
    expect(g).toMatch(/schedule approval card/);
    expect(g).toMatch(/Don't make a file/);
  });
});

import { scrubCredentials, signinGoal } from "@/lib/signin";
describe("a login typed into the chat never reaches the browser goal", () => {
  it.each([
    ["go to the-internet.herokuapp.com/login, log in with tomsmith / SuperSecretPassword! and tell me the secure area text", "SuperSecretPassword!"],
    ["login karo user: abc pass: xyz123", "xyz123"],
    ["tomsmith/abc@123 se login karo", "abc@123"],
  ])("%s", (t, secret) => {
    expect(scrubCredentials(t)).not.toContain(secret);
    expect(signinGoal("x.com", { siteLogin: "v1", check: t })).not.toContain(secret);
  });
  it("keeps the rest of the ask and URLs", () => {
    expect(scrubCredentials("github.com/login pe login karo aur balance batao")).toBe("github.com/login pe login karo aur balance batao");
    expect(signinGoal("x.com", { siteLogin: "v1", check: "tell me the secure area text" })).toMatch(/do not log out or sign in again/);
  });
});
