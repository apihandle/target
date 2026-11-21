import { scrub } from "@/lib/customProvider";
import { GEMINI_DEFAULT_MODEL, SOCIAL_MESSAGE_MAX, type DraftTone } from "@/lib/socialConfig";

/**
 * "Draft with AI" for the social composer: the user's own Gemini key writes a ready-to-post draft from a
 * short topic/brief. The key arrives as a parameter (the route loads it from the caller's sealed row via
 * lib/server/socialKeys.ts) and is sent only in the x-goog-api-key header to Google — never in a URL, a
 * body, a log or a returned string; provider error text passes through scrub() with the key, like every
 * other provider call in this codebase. The result is only a draft: the composer drops it into the
 * textarea and the human edits/confirms before anything is published.
 */
type Fetch = typeof fetch;

const TIMEOUT = 30000;

const TONE_GUIDE: Record<DraftTone, string> = {
  announcement: "an announcement: share the news plainly and warmly",
  tip: "a helpful tip: teach one useful thing the reader can use today",
  question: "an engagement post: end with one genuine question readers can answer",
};

export function draftPrompt(topic: string, tone: DraftTone): string {
  return [
    "Write one social media post for TARGET — Your Personal AI (a personal AI assistant: chat, browse, buy, build and track in one place, at gettarget.vercel.app).",
    `Style: ${TONE_GUIDE[tone]}.`,
    "Rules: plain text only, no emojis, no markdown, no quotation marks around the post, at most 3 short hashtags at the end, keep it under 1000 characters, write in clear simple English.",
    `Topic/brief: ${topic}`,
    "Return only the post text, nothing else.",
  ].join("\n");
}

type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string; status?: string };
};

export type DraftResult = { ok: true; text: string } | { ok: false; error: string };

export async function generateSocialDraft(
  args: { apiKey: string; model?: string | null; topic: string; tone: DraftTone },
  f: Fetch = fetch,
): Promise<DraftResult> {
  const model = args.model?.trim() || GEMINI_DEFAULT_MODEL;
  try {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: draftPrompt(args.topic.trim(), args.tone) }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as GeminiReply;
    if (r.status === 401 || r.status === 403) return { ok: false, error: "Google rejected the saved Gemini key. Check the key in AI Studio, save it again, then retry." };
    if (!r.ok) {
      const detail = j.error?.message ? `: ${scrub(j.error.message, args.apiKey).slice(0, 140)}` : "";
      return { ok: false, error: `Gemini returned an error (HTTP ${r.status})${detail}` };
    }
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim().replace(/^["“]|["”]$/g, "").trim();
    if (!text) return { ok: false, error: "Gemini answered without any text. Try a clearer topic." };
    return { ok: true, text: text.slice(0, SOCIAL_MESSAGE_MAX) };
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, error: "Gemini didn't answer in time. Try again." };
    return { ok: false, error: "Couldn't reach Gemini. Try again in a moment." };
  }
}
