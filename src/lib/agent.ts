import type { LLMMessage } from "@/lib/llm";
import type { ToolOutcome } from "@/lib/connectors/loadTools";

/**
 * Server-side agent loop for OpenAI-compatible tool calling. The model proposes tool calls; this loop
 * hands each to `onTool` (which enforces connection checks and approvals), feeds the results back,
 * and stops when the model answers in text, a tool pauses the task (needs a connection / approval),
 * or the round limit is hit.
 */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export const MAX_ROUNDS = 5;
export const MAX_CALLS_PER_ROUND = 4;

/** Parse an SSE buffer: text deltas plus incremental tool_call fragments merged into `acc` by index. */
export function parseSSEWithTools(buffer: string, acc: Map<number, ToolCall>): { deltas: string[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const deltas: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      const choice = j.choices?.[0];
      const d = choice?.delta ?? choice?.message ?? {};
      if (typeof d.content === "string" && d.content) deltas.push(d.content);
      const calls = (d.tool_calls ?? []) as { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
      calls.forEach((tc, n) => {
        const i = typeof tc.index === "number" ? tc.index : n;
        const cur = acc.get(i) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        acc.set(i, cur);
      });
    } catch { /* keep-alive or partial */ }
  }
  return { deltas, rest };
}

export type AgentResult = {
  text: string;
  pause?: ToolOutcome;
  steps: { connector?: string; tool: string; ok: boolean }[];
  interrupted: boolean;
  hitLimit: boolean;
};

type Opts = {
  messages: LLMMessage[];
  /** First streaming response (already requested by the caller so HTTP errors surface before streaming). */
  first: Response;
  /** Requests the next streaming response for a later round. */
  next: (messages: LLMMessage[]) => Promise<Response>;
  onText: (s: string) => void;
  onTool: (call: ToolCall) => Promise<ToolOutcome>;
  /** Short human-readable label for a tool step (shown in the reply). */
  label?: (call: ToolCall) => string;
  cancelled: () => boolean;
  maxRounds?: number;
};

export async function runAgent(o: Opts): Promise<AgentResult> {
  const messages = [...o.messages];
  const steps: AgentResult["steps"] = [];
  let text = "";
  let res: Response | null = o.first;
  const maxRounds = o.maxRounds ?? MAX_ROUNDS;
  const dec = new TextDecoder();
  for (let round = 0; round < maxRounds && res; round++) {
    const acc = new Map<number, ToolCall>();
    let roundText = "";
    const reader = res.body!.getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || o.cancelled()) break;
        buf += dec.decode(value, { stream: true });
        const { deltas, rest } = parseSSEWithTools(buf, acc);
        buf = rest;
        for (const d of deltas) { roundText += d; text += d; o.onText(d); }
      }
      if (buf.trim()) { const { deltas } = parseSSEWithTools(buf + "\n", acc); for (const d of deltas) { roundText += d; text += d; o.onText(d); } }
    } catch {
      if (o.cancelled()) return { text, steps, interrupted: false, hitLimit: false };
      return { text, steps, interrupted: true, hitLimit: false };
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (o.cancelled()) return { text, steps, interrupted: false, hitLimit: false };

    const calls = Array.from(acc.values()).filter((c) => c.function.name).slice(0, MAX_CALLS_PER_ROUND)
      .map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` }));
    if (!calls.length) return { text, steps, interrupted: false, hitLimit: false };

    messages.push({ role: "assistant", content: roundText || null, tool_calls: calls });
    for (const call of calls) {
      const note = `\n\n> ${o.label ? o.label(call) : call.function.name}\n\n`;
      text += note; o.onText(note);
      const outcome = await o.onTool(call);
      steps.push({ connector: "connector" in outcome ? outcome.connector : undefined, tool: call.function.name, ok: outcome.kind === "result" });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
      if (outcome.kind === "needs_connection" || outcome.kind === "approval") return { text, pause: outcome, steps, interrupted: false, hitLimit: false };
    }
    if (round + 1 >= maxRounds) break;
    try { res = await o.next(messages); } catch { return { text, steps, interrupted: true, hitLimit: false }; }
  }
  return { text, steps, interrupted: false, hitLimit: true };
}
