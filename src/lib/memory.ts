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
/** Facts tied to a moment ("tomorrow at 9 AM") are plans, not lasting memories. */
export function isTransient(fact: string): boolean {
  return /\b(today|tomorrow|tonight|yesterday|this (week|weekend|evening|morning)|next (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|aaj|kal|parso|\d{1,2}(:\d{2})?\s?(am|pm))\b/i.test(fact);
}

/** Never store anything that looks like a password, key or card number as a memory. */
export function looksSecret(fact: string): boolean {
  return /\b(password|passwd|pin|otp|cvv|api[ _-]?key|secret|token)\b|\b(?:\d[ -]?){13,19}\b|sk-[A-Za-z0-9]{10,}/i.test(fact);
}

export function parseFacts(raw: string): string[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === "string").map(cleanFact).filter((x) => x.length >= 3 && !isTransient(x) && !looksSecret(x)).slice(0, 5);
  } catch {
    return [];
  }
}

export function memoryBlock(memories: string[]): string {
  if (!memories.length) return "";
  return (
    "\n\nWhat you remember about this user (use quietly to personalize every answer: their language, level, city, goals, tools; " +
    "don't recite unless asked; if they ask what you remember, summarize it; if a newer message contradicts a memory, trust the newer message):\n" +
    memories.map((m) => `- ${m}`).join("\n")
  );
}

export const EXTRACT_PROMPT =
  "You extract long-term memories about a user from their latest chat message (it may be in Hindi, Hinglish or English). " +
  "Keep only durable personal facts or preferences worth remembering for future chats: name and what to call them, city, language, " +
  "job or studies (class, exam, college, skills), projects and businesses they run, tools and tech stack they use, people in their life " +
  "(relation and name), health conditions or diet they mention, goals, budget level, likes and dislikes, and how they like answers (short, Hinglish, detailed). " +
  "Ignore questions, one-off tasks and plans (a meeting on some date, a single trip), greetings, passwords or keys, and anything about the assistant. " +
  "If the message updates a known fact (moved city, new job), write the new fact. " +
  "Write each fact as a short third-person sentence in English, e.g. \"Lives in Patna\", \"Is preparing for the NEET exam\". " +
  "Do not repeat facts already known. Reply with ONLY a JSON array of strings (at most 5), [] if nothing.";
