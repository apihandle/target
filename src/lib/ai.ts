export type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

export const SYSTEM_PROMPT =
  "You are TARGET, a sharp, warm personal AI that helps people get things done. " +
  "Answer first, be specific and concise, take a side when asked for a recommendation. " +
  "Reply in the user's language and style (Hinglish if they write Hinglish). Use markdown when it helps.";

export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47).trimEnd() + "…" : t || "New chat";
}

/** Parse an OpenAI-style SSE chunk buffer; returns content deltas and leftover partial line. */
export function parseSSE(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const deltas: string[] = [];
  let done = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const j = JSON.parse(data);
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === "string" && d) deltas.push(d);
    } catch { /* ignore keep-alives */ }
  }
  return { deltas, rest, done };
}
