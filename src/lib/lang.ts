/**
 * Which language the user is writing in, so replies that are built from English material (a web page,
 * a browser report, a fixed status line) still come back in the user's language, like normal chat.
 */
export type Lang = "hinglish" | "hindi" | "english";

const DEVANAGARI = /[\u0900-\u097F]/;
// Words that are almost never English: one is enough.
const STRONG = /\b(karo|kar ?do|kardo|karna|karke|kariye|kijiye|batao|bataiye|bata|kholo|dikhao|nahi|nahin|nhi|hai|hain|mujhe|mera|meri|mere|kya|kaise|kyun|kyu|kab|kitna|kitne|chahiye|abhi|aur|bhai|yaar|haan|theek|thik|accha|acha|achha|toh|wala|wali|gaya|gayi|hoga|raha|rahi|sakta|sakte|jao|aap|tum|tera|apna|apne|hua|hui|dekho|samjha|matlab)\b/i;
// Short words that also show up in English text or names: need two.
const WEAK = /\b(pe|par|ka|ki|ke|se|ko|ho|ye|yeh|wo|woh|mein|bhi|sab|kuch|ek)\b/gi;
const ENGLISH = /\b(the|please|can|could|would|you|my|to|and|is|are|what|show|open|sign|log|into|with|for|me|check|tell|how)\b/gi;

/** The language of one message, or null when there are too few words to tell. */
export function detectLang(text: string | null | undefined): Lang | null {
  const t = (text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\b[\w-]+(\.[\w-]+)+\b/g, " ").slice(0, 2000);
  if (DEVANAGARI.test(t)) return "hindi";
  if (STRONG.test(t)) return "hinglish";
  const weak = t.match(WEAK)?.length ?? 0;
  if (weak >= 2) return "hinglish";
  const en = t.match(ENGLISH)?.length ?? 0;
  if (en >= 1 && weak === 0) return "english";
  return null;
}

/** The current message decides; when it is too short to tell ("github.com login"), the user's recent messages do. */
export function userLang(text: string, earlierUserMessages: string[] = []): Lang | null {
  const now = detectLang(text);
  if (now) return now;
  for (const m of [...earlierUserMessages].reverse().slice(0, 6)) {
    const l = detectLang(m);
    if (l) return l;
  }
  return null;
}

/** A firm instruction for the model; placed last so English page text above it doesn't pull the reply into English. */
export function langRule(lang: Lang | null): string {
  if (lang === "hinglish") return "\n\nLANGUAGE: The user writes in Hinglish. Write your whole reply in Hinglish (Hindi in Roman letters, mixed with common English words), even though the page text above is in English. Example style: \"✓ Login ho gaya. Dashboard pe balance $0.42 dikh raha hai.\"";
  if (lang === "hindi") return "\n\nLANGUAGE: The user writes in Hindi. Write your whole reply in Hindi (Devanagari), even though the page text above is in English.";
  if (lang === "english") return "\n\nLANGUAGE: The user writes in English. Reply in English.";
  return "\n\nLANGUAGE: Reply in the same language and script the user wrote their last message in (Hinglish if they write Hinglish), even though the page text above is in English.";
}

/** One sentence for the browser agent so its own page report comes back in the user's language. */
export function reportLangHint(lang: Lang | null | undefined): string {
  if (lang === "hinglish") return "Write the done report in Hinglish (Hindi in Roman letters), keeping names and numbers exactly as shown.";
  if (lang === "hindi") return "Write the done report in Hindi, keeping names and numbers exactly as shown.";
  return "";
}

export const isLang = (v: unknown): v is Lang => v === "hinglish" || v === "hindi" || v === "english";
