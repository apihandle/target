import type { ModelRef } from "@/lib/llm";

/**
 * Task-aware "skills" for the chat: detect what kind of help the message needs, then add a focused
 * playbook to the system prompt, give the reply room to be complete, and prefer a model that is
 * strong at that kind of work. Every other configured model stays as fallback.
 */
export type TaskKind = "code" | "math" | "study" | "health" | "money" | "career" | "business" | "legal" | "travel" | "cooking" | "writing" | "research" | "general";

const CODE_RE = /```|\b(code|coding|program|script|function|bug|debug|error|exception|stack ?trace|compile|refactor|regex|sql|query|api|endpoint|json|yaml|html|css|tailwind|javascript|typescript|python|java|kotlin|swift|golang|rust|c\+\+|c#|php|ruby|bash|shell|react|next\.?js|node|django|flask|docker|kubernetes|git|github|npm|pip|leetcode|algorithm|class|component|deploy|vercel|supabase|firebase|website banao|app banao|website bana|app bana)\b/i;
const CODE_SYNTAX_RE = /(=>|\bconst |\blet |\bdef |\bimport |\breturn |;\s*$|<\/?[a-z]+[^>]*>|\{\s*$|Traceback \(most recent call last\)|TypeError|SyntaxError|ReferenceError)/m;
const MATH_RE = /\b(solve|calculate|equation|integral|derivative|probability|percentage|percent|formula|prove|math|maths|algebra|geometry|trigonometry|matrix|sawal hal|hisab|nikalo)\b|\d+\s*[-+*/^×÷]\s*\d+/i;
const DOMAINS: [Exclude<TaskKind, "code" | "math" | "writing" | "research" | "general">, RegExp][] = [
  ["health", /\b(health|doctor|symptom|fever|bukhar|pain|dard|medicine|dawa|tablet|diet|weight loss|wajan|workout|exercise|gym|yoga|sleep|neend|bp|sugar|diabetes|pregnan|skin|hair fall|mental health|anxiety|stress)\b/i],
  ["money", /\b(money|paisa|paise|salary|budget|saving|bachat|invest|sip|mutual fund|stock|share market|trading|crypto|loan|emi|interest|byaj|tax|itr|gst|insurance|credit card|upi|fd|ppf|nps|kamai|earning|earn online)\b/i],
  ["study", /\b(study|padhai|exam|neet|jee|upsc|ssc|bpsc|board|class \d+|syllabus|notes|chapter|question paper|mcq|revision|timetable|homework|assignment|physics|chemistry|biology|history|geography|economics|polity|english grammar|learn|seekhna|sikhao|samjhao|explain like)\b/i],
  ["career", /\b(job|naukri|career|resume|cv|interview|internship|hiring|apply|linkedin|promotion|freelanc|skill|course|placement|offer letter|switch job)\b/i],
  ["business", /\b(business|startup|dhandha|shop|dukan|customer|marketing|sales|brand|instagram growth|youtube channel|seo|ads|pricing|profit|revenue|pitch|investor|ecommerce|dropshipping|franchise|business plan)\b/i],
  ["legal", /\b(legal|law|kanoon|court|case|fir|police|rent agreement|contract|property|zameen|registry|consumer complaint|rti|divorce|will|notice|lawyer|vakil|rights)\b/i],
  ["travel", /\b(travel|trip|tour|ghumna|flight|train|irctc|hotel|visa|passport|itinerary|places to visit|ghoomne)\b/i],
  ["cooking", /\b(recipe|cook|khana|banane ki vidhi|kaise banaye|dish|breakfast|lunch|dinner|sabzi|dal|biryani|cake|meal plan)\b/i],
];

const WRITING_RE = /\b(write|draft|rewrite|essay|email|letter|application|caption|post|blog|story|poem|resume|cv|cover letter|speech|bio|likho|likh do|translate|summari[sz]e)\b/i;
const RESEARCH_RE = /\b(compare|vs\.?|versus|best|top \d+|review|pros and cons|explain|kya hai|kaise kaam|difference between|research)\b/i;

export function detectTask(text: string): TaskKind {
  const t = text.slice(0, 4000);
  if (CODE_RE.test(t) || CODE_SYNTAX_RE.test(t)) return "code";
  if (MATH_RE.test(t)) return "math";
  for (const [kind, re] of DOMAINS) if (re.test(t)) return kind;
  if (WRITING_RE.test(t)) return "writing";
  if (RESEARCH_RE.test(t)) return "research";
  return "general";
}

export const PLAYBOOKS: Record<TaskKind, string> = {
  code:
    "\n\nCODING MODE. Act as a senior software engineer.\n" +
    "- First understand the goal; if something essential is missing, make a sensible assumption and state it in one line rather than stalling.\n" +
    "- Give complete, runnable code in fenced blocks with the language tag. Never leave placeholders like '...rest of code' unless the user asked for a snippet; include imports.\n" +
    "- For a bug: name the root cause in one or two lines, show the fix (the changed code), then how to verify it.\n" +
    "- For bigger builds: a short plan (files and steps), then each file with its path as a heading, then the commands to install and run.\n" +
    "- Prefer modern, idiomatic, secure code: validate input, never hard-code secrets (use environment variables), handle errors.\n" +
    "- Mention tests or an example run when it helps. Keep explanations short; the code is the answer.",
  math:
    "\n\nMATH MODE. Solve step by step: write what is given, the method, each step with the working, then the final answer on its own line in bold. Double-check arithmetic before answering. Use plain text or simple LaTeX-free notation that reads well in chat.",
  writing:
    "\n\nWRITING MODE. Write the finished piece, ready to use, in the tone and language the user wants (match Hinglish if they use it). Keep it natural and specific, no filler. For emails and letters include a subject line. Offer one short variation only if it clearly helps.",
  research:
    "\n\nANALYSIS MODE. Lead with the direct answer or recommendation, then the key reasons. For comparisons use a compact markdown table. Use any web results provided and cite them as [n]; if facts may be outdated, say so in one line.",
  study:
    "\n\nTEACHER MODE. Explain like a great teacher: simple words first, then the exact concept, a real-life example, and a quick memory trick. " +
    "For exam questions give the answer in the format the exam expects (points, diagrams described in words, key terms). End with 2-3 practice questions when it helps. For a study plan, give a day-wise timetable.",
  health:
    "\n\nHEALTH MODE. Give clear, practical, evidence-based guidance: likely causes, safe home care, what to avoid, and clear red-flag signs that need a doctor now. " +
    "Never diagnose with certainty or prescribe prescription-only medicine doses; suggest seeing a doctor for anything serious, persistent or for children, pregnancy and elderly people. For fitness or diet, give a concrete plan.",
  money:
    "\n\nMONEY MODE. Be practical and India-aware (₹, UPI, SIP, PPF, tax slabs) unless the user is elsewhere. Show the math with real numbers. " +
    "Explain risks plainly, never promise returns, warn about scams (guaranteed income, task-based earning frauds, doubling schemes). This is general information, not personalised financial advice.",
  career:
    "\n\nCAREER MODE. Act as a career coach: concrete steps, skills to learn with free resources, realistic timelines and salary ranges where known. For resumes give rewritten bullet points with impact and numbers; for interviews give likely questions with strong sample answers.",
  business:
    "\n\nBUSINESS MODE. Act as a sharp business advisor: target customer, offer, pricing, costs and simple profit math, marketing channels that fit a small budget, and the first 3 actions for this week. Be honest about risks.",
  legal:
    "\n\nLEGAL INFO MODE. Explain the relevant law and process in simple words (India by default unless the user is elsewhere): rights, steps, documents needed, where to file, typical timelines and costs. Draft notices or complaints when asked. Say this is general information and suggest a lawyer for serious matters.",
  travel:
    "\n\nTRAVEL MODE. Plan concretely: best route and transport options with rough costs, a day-by-day itinerary, where to stay by budget, local food, and practical tips (weather, bookings, safety). Don't invent exact prices or timings; give ranges and say to check live.",
  cooking:
    "\n\nCOOKING MODE. Give the recipe with servings, an ingredient list with quantities, numbered steps with times and heat levels, and tips for common mistakes. Offer simple swaps for missing ingredients.",
  general: "",
};

/** Several asks in one message: numbered lists, multiple questions, or "aur ... aur". */
export function isMultiTask(text: string): boolean {
  const t = text.slice(0, 4000);
  const numbered = (t.match(/(^|\n)\s*(\d+[.)]|[-*•])\s+\S/g) ?? []).length;
  const questions = (t.match(/\?/g) ?? []).length;
  const joins = (t.match(/\b(aur|and also|also|saath me|plus|dusra|doosra|teesra|second|third|then)\b/gi) ?? []).length;
  return numbered >= 2 || questions >= 2 || joins >= 2;
}

export const MULTI_PLAYBOOK =
  "\n\nMULTI-TASK. The user asked for several things. Handle EVERY one, in their order, each under its own short heading (1, 2, 3...). " +
  "Don't skip or merge any; if one needs information you don't have, answer the rest and ask for that one at the end.";

/** What the app itself can do, so the model can point to the right feature instead of saying it can't. */
export const CAPABILITIES =
  "\n\nTARGET app features you can point to (the app shows one-tap buttons for these after your reply, and the user approves them): " +
  "save something to memory (the user can say 'yaad rakhna ki ...'), add tasks to their to-do list, set a one-time reminder, or schedule a prompt every few hours, daily or weekly at a time " +
  "(for example a morning news brief or a weekly plan), start a project for a longer effort, add a reminder to the calendar, and pin a live panel to Home (weather, countdown, crypto price, note). " +
  "TARGET also opens links the user pastes and reads the page for you (shown as LINKS THE USER SHARED); if a link couldn't be read, say why. " +
  "Your own target__ tools (no account needed): generate_image, create_chart, image_search, youtube_transcript, read_webpage, create_file (PDF/CSV download), create_page (shareable Page), run_parallel (2-4 research questions at once), list_vault and browser_task. " +
  "Use them whenever they fit (\"ek logo banao\" = generate_image, \"is video ka summary\" = youtube_transcript, \"PDF bana do\" = create_file) and show images as markdown ![caption](url). " +
  "When the user asks for any of these, say in one line what will be set up (what, when, how often) so the button matches; never claim it is already done.";

/** Room for the reply: code and long writing need more tokens than a quick answer. */
export const MAX_TOKENS: Record<TaskKind, number> = {
  code: 8192, math: 4096, study: 4096, health: 3072, money: 4096, career: 4096, business: 4096, legal: 4096, travel: 4096, cooking: 3072,
  writing: 4096, research: 4096, general: 3072,
};

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Preferred model for a task, from CODE_MODEL / MATH_MODEL ("provider:model"), with a strong coding
 * default on NVIDIA. Returns null when nothing specific applies (the normal order is used).
 */
export function taskModel(kind: TaskKind, env: Record<string, string | undefined> = process.env): ModelRef | null {
  const raw = kind === "code" ? list(env.CODE_MODEL)[0] ?? (env.NVIDIA_API_KEY ? "nvidia:qwen/qwen3-coder-480b-a35b-instruct" : "")
    : kind === "math" ? list(env.MATH_MODEL)[0] ?? ""
    : "";
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  return { provider: raw.slice(0, i), model: raw.slice(i + 1) };
}
