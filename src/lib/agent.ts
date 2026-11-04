import type { LLMMessage } from "@/lib/llm";
import type { ToolOutcome } from "@/lib/connectors/loadTools";

/**
 * Server-side agent loop for OpenAI-compatible tool calling. The model proposes tool calls; this loop
 * hands each to `onTool` (which enforces connection checks and approvals), feeds the results back,
 * and stops when the model answers in text, a tool pauses the task (needs a connection / approval),
 * or the round limit is hit.
 */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export const MAX_ROUNDS = 8;
export const MAX_CALLS_PER_ROUND = 6;

/** Said to the model when the tool rounds or the time budget run out: answer from what was gathered. */
export const WRAP_UP = "STOP calling tools now. Using only the tool results above, give the user the complete answer to their request in their language (tables, lists, summaries as they asked). If some part could not be done, say exactly which part and why in one line. Do not mention step limits.";

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
  /** Stop starting new tool rounds after this time (ms epoch) and wrap up, so the reply lands inside the function limit. */
  deadline?: number;
  /**
   * One last request WITHOUT tools when the rounds or the time run out, so a multi-step task ends in an answer built
   * from what was gathered instead of "I stopped after several tool steps".
   */
  final?: (messages: LLMMessage[]) => Promise<Response>;
};

/**
 * The conversation with tool calls and results turned into plain turns, for a request sent without tools
 * (several providers refuse tool messages when no tools are offered).
 */
export function flattenTools(messages: LLMMessage[]): LLMMessage[] {
  const names = new Map<string, string>();
  const out: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length) {
      for (const c of m.tool_calls) names.set(c.id, c.function.name);
      out.push({ role: "assistant", content: `${m.content ? `${m.content}\n` : ""}(Used tools: ${m.tool_calls.map((c) => c.function.name.split("__").pop()).join(", ")})` });
    } else if (m.role === "tool") {
      const id = "tool_call_id" in m ? m.tool_call_id ?? "" : "";
      out.push({ role: "user", content: `Tool result (${(names.get(id) ?? "tool").split("__").pop()}):\n${String(m.content ?? "").slice(0, 12000)}` });
    } else out.push(m);
  }
  return out;
}

/** Stream a plain text response (no tool calls expected) into the reply. */
async function streamText(res: Response, o: Opts): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const acc = new Map<number, ToolCall>();
  let buf = "", text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || o.cancelled()) break;
      buf += dec.decode(value, { stream: true });
      const { deltas, rest } = parseSSEWithTools(buf, acc);
      buf = rest;
      for (const d of deltas) { text += d; o.onText(d); }
    }
    if (buf.trim()) { const { deltas } = parseSSEWithTools(buf + "\n", acc); for (const d of deltas) { text += d; o.onText(d); } }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return text;
}

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
    if (round + 1 >= maxRounds || (o.deadline && Date.now() > o.deadline)) break;
    try { res = await o.next(messages); } catch { return { text, steps, interrupted: true, hitLimit: false }; }
  }
  if (o.final && !o.cancelled()) {
    try {
      const sep = text && !text.endsWith("\n\n") ? "\n\n" : "";
      if (sep) { text += sep; o.onText(sep); }
      const t = await streamText(await o.final([...flattenTools(messages), { role: "user", content: WRAP_UP }]), o);
      text += t;
      if (t.trim()) return { text, steps, interrupted: false, hitLimit: false };
    } catch { /* fall through to the limit note */ }
  }
  return { text, steps, interrupted: false, hitLimit: true };
}
