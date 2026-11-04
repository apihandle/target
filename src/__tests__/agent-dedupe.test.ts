import { describe, expect, it, vi } from "vitest";
import { callKey, runAgent } from "@/lib/agent";

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const tc = (index: number, id: string, name: string, args: string) => ({ index, id, function: { name, arguments: args } });
const calls = (...c: ReturnType<typeof tc>[]) => sse([{ choices: [{ delta: { tool_calls: c } }] }]);
const text = (t: string) => sse([{ choices: [{ delta: { content: t } }] }]);
const FILE = '{"name":"fake-list.txt","content":"milk, eggs, bread"}';

describe("one turn never runs the same acting tool call twice", () => {
  it("drops an identical create call in the same round and in a later round", async () => {
    const onTool = vi.fn(async (c: { function: { name: string } }) => ({ kind: "result" as const, content: `ok ${c.function.name}`, connector: "target", tool: c.function.name }));
    const next = vi.fn()
      .mockResolvedValueOnce(calls(tc(0, "b1", "target__create_file", '{ "content": "milk,  eggs, bread", "name": "fake-list.txt" }'), tc(1, "b2", "target__create_schedule", '{"cadence":"weekly"}')))
      .mockResolvedValueOnce(text("All set."));
    const out: string[] = [];
    const r = await runAgent({ messages: [], first: calls(tc(0, "a1", "target__create_file", FILE), tc(1, "a2", "target__create_file", FILE)), next, onText: (s) => out.push(s), onTool, cancelled: () => false });
    const names = onTool.mock.calls.map(([c]) => c.function.name);
    expect(names).toEqual(["target__create_file", "target__create_schedule"]);
    expect(out.join("").match(/target__create_file/g)).toHaveLength(1);
    expect(r.text).toMatch(/All set/);
    const second = next.mock.calls[1][0] as { role: string; content: string }[];
    expect(second.filter((m) => m.role === "tool" && /not repeated/.test(m.content))).toHaveLength(2);
  });

  it("still runs a different create and a repeated read tool", async () => {
    const ok = vi.fn(async () => ({ kind: "result" as const, content: "ok", connector: "target", tool: "t" }));
    await runAgent({ messages: [], first: calls(tc(0, "a", "target__read_webpage", '{"url":"https://example.com"}'), tc(1, "b", "target__read_webpage", '{"url":"https://example.com"}'), tc(2, "c", "target__create_file", FILE), tc(3, "d", "target__create_file", '{"name":"other.txt","content":"x"}')), next: async () => text("done"), onText: () => undefined, onTool: ok, cancelled: () => false });
    expect(ok).toHaveBeenCalledTimes(4);
  });

  it("callKey ignores key order and extra spaces", () => {
    const k = (args: string) => callKey({ id: "x", type: "function", function: { name: "target__create_file", arguments: args } });
    expect(k('{"a":1,"b":"x  y"}')).toBe(k('{ "b": "x y", "a": 1 }'));
    expect(k('{"a":1}')).not.toBe(k('{"a":2}'));
  });
});
