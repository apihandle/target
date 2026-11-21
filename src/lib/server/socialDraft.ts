import { scrub } from "@/lib/customProvider";
import {
  GEMINI_DEFAULT_MODEL, NVIDIA_API_BASE, NVIDIA_DEFAULT_MODEL, NVIDIA_MODELS, SOCIAL_AI_PROVIDER_LABEL,
  SOCIAL_MESSAGE_MAX, SOCIAL_TITLE_MAX, type DraftTone, type SocialAiProvider,
} from "@/lib/socialConfig";

/**
 * The AI text generators behind social posting, over two transports with the same contract
 * (callGemini / callNvidia): the key arrives as a parameter (the caller loads it from the user's
 * sealed row via lib/server/socialKeys.ts — loadSocialWriterKey prefers NVIDIA, Gemini is the
 * fallback) and is sent only in a header (x-goog-api-key to Google, Authorization: Bearer to
 * NVIDIA) — never in a URL, a log or a returned string; provider error text passes through scrub()
 * with the key, like every other provider call in this codebase.
 *
 * "Draft with AI" for the social composer: the user's own key writes a ready-to-post draft from
 * a short topic/brief. The result is only a draft: the composer drops it into the textarea and the
 * human edits/confirms before anything is published.
 *
 * generateBlogPost is the autopilot sibling (lib/server/socialAutopilot.ts): same key resolution,
 * but it writes a full blog post (title + body) that goes out with no human review — that is the
 * feature the user explicitly turned on.
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

/**
 * The one Gemini generateContent call behind every social text generator in this module: the key goes
 * only in the x-goog-api-key header, provider error text is scrubbed of the key, and every failure is
 * mapped to a short safe sentence. Returns the model's raw text (callers shape it).
 */
async function callGemini(
  args: { apiKey: string; model?: string | null; prompt: string; maxOutputTokens: number },
  f: Fetch,
): Promise<DraftResult> {
  const model = args.model?.trim() || GEMINI_DEFAULT_MODEL;
  try {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: args.maxOutputTokens },
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
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, error: "Gemini answered without any text. Try a clearer topic." };
    return { ok: true, text };
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, error: "Gemini didn't answer in time. Try again." };
    return { ok: false, error: "Couldn't reach Gemini. Try again in a moment." };
  }
}

type NvidiaReply = {
  choices?: { message?: { content?: string | { text?: string }[] } }[];
  error?: { message?: string };
  detail?: string;
};

/**
 * One chat-completions call to ONE NVIDIA model. Same contract as callGemini — the key only in
 * the Authorization: Bearer header, provider error text scrubbed of the key, every failure mapped
 * to a short safe sentence — plus `modelGone`: true when the endpoint says this model itself is
 * gone (HTTP 410 retired / 404 unknown), the one failure a different model can fix.
 */
async function callNvidiaOnce(
  args: { apiKey: string; model: string; prompt: string; maxOutputTokens: number },
  f: Fetch,
): Promise<{ result: DraftResult; modelGone: boolean }> {
  try {
    const r = await f(`${NVIDIA_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: "user", content: args.prompt }],
        temperature: 0.8,
        max_tokens: args.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as NvidiaReply;
    if (r.status === 401 || r.status === 403) return { modelGone: false, result: { ok: false, error: "NVIDIA rejected the saved API key. Check the key at build.nvidia.com, save it again, then retry." } };
    if (!r.ok) {
      const raw = j.error?.message ?? j.detail ?? "";
      const detail = raw ? `: ${scrub(raw, args.apiKey).slice(0, 140)}` : "";
      return { modelGone: r.status === 410 || r.status === 404, result: { ok: false, error: `NVIDIA returned an error (HTTP ${r.status})${detail}` } };
    }
    const content = j.choices?.[0]?.message?.content;
    const text = (typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? "").join("")).trim();
    if (!text) return { modelGone: false, result: { ok: false, error: "NVIDIA answered without any text. Try a clearer topic." } };
    return { modelGone: false, result: { ok: true, text } };
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { modelGone: false, result: { ok: false, error: "NVIDIA didn't answer in time. Try again." } };
    return { modelGone: false, result: { ok: false, error: "Couldn't reach NVIDIA. Try again in a moment." } };
  }
}

/**
 * The NVIDIA twin of callGemini: chat completions on integrate.api.nvidia.com (the OpenAI-compatible
 * endpoint TARGET's chat providers already use). NVIDIA retires catalog models — the saved model
 * (or the default) can be end-of-life while the key is perfectly good — so on a model-gone answer
 * (410/404) the call walks the NVIDIA_MODELS ladder before giving up; every other outcome
 * (success, key rejection, timeout, other errors) returns exactly as a single call would.
 */
async function callNvidia(
  args: { apiKey: string; model?: string | null; prompt: string; maxOutputTokens: number },
  f: Fetch,
): Promise<DraftResult> {
  const requested = args.model?.trim() || NVIDIA_DEFAULT_MODEL;
  const ladder = [...new Set([requested, ...NVIDIA_MODELS])];
  let last: DraftResult = { ok: false, error: "Couldn't reach NVIDIA. Try again in a moment." };
  for (const model of ladder) {
    const { result, modelGone } = await callNvidiaOnce({ ...args, model }, f);
    if (result.ok || !modelGone) return result;
    last = result;
  }
  return last;
}

/** Run one prompt on the chosen provider's transport (NVIDIA when the writer key is NVIDIA's, else Gemini). */
function callProvider(
  provider: SocialAiProvider,
  args: { apiKey: string; model?: string | null; prompt: string; maxOutputTokens: number },
  f: Fetch,
): Promise<DraftResult> {
  return provider === "nvidia" ? callNvidia(args, f) : callGemini(args, f);
}

export async function generateSocialDraft(
  args: { provider?: SocialAiProvider; apiKey: string; model?: string | null; topic: string; tone: DraftTone },
  f: Fetch = fetch,
): Promise<DraftResult> {
  const provider = args.provider ?? "gemini";
  const r = await callProvider(
    provider,
    { apiKey: args.apiKey, model: args.model, prompt: draftPrompt(args.topic.trim(), args.tone), maxOutputTokens: 512 },
    f,
  );
  if (!r.ok) return r;
  const text = r.text.replace(/^["“]|["”]$/g, "").trim();
  if (!text) return { ok: false, error: `${SOCIAL_AI_PROVIDER_LABEL[provider]} answered without any text. Try a clearer topic.` };
  return { ok: true, text: text.slice(0, SOCIAL_MESSAGE_MAX) };
}

export function blogPostPrompt(topic: string): string {
  return [
    "Write one blog post for a Blogger blog.",
    "Format the reply exactly like this: the first line starts with 'TITLE: ' followed by the post title, then a blank line, then the article body as 3 to 5 short paragraphs separated by blank lines.",
    "Rules: plain text only, no HTML, no markdown, no emojis, no hashtags, clear simple English, keep the whole body under 1800 characters, and stay honest — do not invent prices, dates, statistics or product claims.",
    `Topic/niche the blog is about: ${topic}`,
    "Pick one fresh angle on that topic (do not just restate the topic as the title). Return only the title line and the body, nothing else.",
  ].join("\n");
}

export type BlogPostResult = { ok: true; title: string; body: string } | { ok: false; error: string };

/** A body shorter than this is a stub, not a post — the autopilot skips the run and tries again later. */
const BLOG_BODY_MIN = 50;

/**
 * Shape a model reply into { title, body }: a leading "TITLE:" line when present, else the first
 * non-empty line is the title. Any HTML the model emits anyway is stripped — the body is stored as
 * plain text and the publisher (lib/server/socialPost.ts) turns its paragraphs into HTML, so raw
 * tags here would only be escaped and shown to readers.
 */
export function parseBlogPost(text: string): { title: string; body: string } | null {
  const clean = text.replace(/<[^>]*>/g, "").trim();
  if (!clean) return null;
  const lines = clean.split("\n");
  const m = lines[0].match(/^TITLE:\s*(.+)$/i);
  const rawTitle = m ? m[1] : lines[0];
  const title = rawTitle.replace(/^["“]|["”]$/g, "").trim().slice(0, SOCIAL_TITLE_MAX);
  const body = lines.slice(1).join("\n").trim().slice(0, SOCIAL_MESSAGE_MAX);
  if (!title || body.length < BLOG_BODY_MIN) return null;
  return { title, body };
}

/**
 * One autopilot blog post (title + body) on the user's topic, written by their own writer key
 * (NVIDIA preferred, Gemini fallback — loadSocialWriterKey) — the blog sibling of
 * generateSocialDraft, over the same transports. The body is plain text with blank-line
 * paragraph breaks; the scheduled-post publisher renders it as HTML paragraphs on the blog.
 */
export async function generateBlogPost(
  args: { provider?: SocialAiProvider; apiKey: string; model?: string | null; topic: string },
  f: Fetch = fetch,
): Promise<BlogPostResult> {
  const provider = args.provider ?? "gemini";
  const r = await callProvider(
    provider,
    { apiKey: args.apiKey, model: args.model, prompt: blogPostPrompt(args.topic.trim()), maxOutputTokens: 1024 },
    f,
  );
  if (!r.ok) return r;
  const parsed = parseBlogPost(r.text);
  if (!parsed) return { ok: false, error: `${SOCIAL_AI_PROVIDER_LABEL[provider]}'s answer didn't look like a blog post, so nothing was queued. Autopilot will try again on the next run.` };
  return { ok: true, ...parsed };
}
