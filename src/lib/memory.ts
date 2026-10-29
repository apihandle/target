export type Memory = { id: string; content: string; source?: string; created_at?: string };

export const MAX_MEMORIES = 200;
export const MAX_MEMORY_LEN = 500;

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff ]/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanFact(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/^["'“”\-•*\d.)\s]+/, "").replace(/["'“”]+$/, "").slice(0, MAX_MEMORY_LEN).trim();
}

/** "remember that X" / "yaad rakhna ki X" / "note: X" -> X */
export function explicitRemember(text: string): string | null {
  const t = text.trim();
  const patterns = [
    /^(?:please\s+)?(?:remember|memorize|note)\s*(?:that|this|:|-)?\s+(.{3,})$/i,
    /^(?:ye\s+|yeh\s+|ek\s+baat\s+)?yaad\s+rakh(?:o|na|iye|ना)?\s*(?:ki|ke|:|-)?\s+(.{3,})$/i,
    /^(.{3,}?)\s*[,.-]?\s*(?:ye\s+|yeh\s+)?yaad\s+rakh(?:o|na|iye)\.?$/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const f = cleanFact(m[1]);
      if (f.length >= 3) return f;
    }
  }
  return null;
}

export function isDuplicate(fact: string, existing: string[]): boolean {
  const n = normalize(fact);
  if (!n) return true;
  return existing.some((e) => {
    const x = normalize(e);
    return x === n || (n.length > 12 && (x.includes(n) || n.includes(x) && x.length > 12));
  });
}

/** Parse the extractor model's answer into a list of facts (tolerates code fences / prose). */
export function parseFacts(raw: string): string[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === "string").map(cleanFact).filter((x) => x.length >= 3).slice(0, 3);
  } catch {
    return [];
  }
}

export function memoryBlock(memories: string[]): string {
  if (!memories.length) return "";
  return (
    "\n\nWhat you remember about this user (use quietly to personalize; don't recite unless asked; " +
    "if they ask what you remember, summarize it):\n" +
    memories.map((m) => `- ${m}`).join("\n")
  );
}

export const EXTRACT_PROMPT =
  "You extract long-term memories about a user from their latest chat message. " +
  "Keep only durable personal facts or preferences worth remembering for future chats " +
  "(name, location, job, projects, people in their life, likes/dislikes, diet, goals, how they like answers). " +
  "Ignore questions, one-off tasks and plans (a meeting on some date, a single trip), greetings and anything about the assistant. " +
  "Write each fact as a short third-person sentence in English, e.g. \"Lives in Patna\". " +
  "Do not repeat facts already known. Reply with ONLY a JSON array of strings, [] if nothing.";
