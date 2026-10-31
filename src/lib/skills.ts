import type { ModelRef } from "@/lib/llm";

/**
 * Task-aware "skills" for the chat: detect what kind of help the message needs, then add a focused
 * playbook to the system prompt, give the reply room to be complete, and prefer a model that is
 * strong at that kind of work. Every other configured model stays as fallback.
 */
export type TaskKind = "code" | "math" | "writing" | "research" | "general";

const CODE_RE = /```|\b(code|coding|program|script|function|bug|debug|error|exception|stack ?trace|compile|refactor|regex|sql|query|api|endpoint|json|yaml|html|css|tailwind|javascript|typescript|python|java|kotlin|swift|golang|rust|c\+\+|c#|php|ruby|bash|shell|react|next\.?js|node|django|flask|docker|kubernetes|git|github|npm|pip|leetcode|algorithm|class|component|deploy|vercel|supabase|firebase|website banao|app banao|website bana|app bana)\b/i;
const CODE_SYNTAX_RE = /(=>|\bconst |\blet |\bdef |\bimport |\breturn |;\s*$|<\/?[a-z]+[^>]*>|\{\s*$|Traceback \(most recent call last\)|TypeError|SyntaxError|ReferenceError)/m;
const MATH_RE = /\b(solve|calculate|equation|integral|derivative|probability|percentage|percent|formula|prove|math|maths|algebra|geometry|trigonometry|matrix|sawal hal|hisab|nikalo)\b|\d+\s*[-+*/^×÷]\s*\d+/i;
const WRITING_RE = /\b(write|draft|rewrite|essay|email|letter|application|caption|post|blog|story|poem|resume|cv|cover letter|speech|bio|likho|likh do|translate|summari[sz]e)\b/i;
const RESEARCH_RE = /\b(compare|vs\.?|versus|best|top \d+|review|pros and cons|explain|kya hai|kaise kaam|difference between|research)\b/i;

export function detectTask(text: string): TaskKind {
  const t = text.slice(0, 4000);
  if (CODE_RE.test(t) || CODE_SYNTAX_RE.test(t)) return "code";
  if (MATH_RE.test(t)) return "math";
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
  general: "",
};

/** Room for the reply: code and long writing need more tokens than a quick answer. */
export const MAX_TOKENS: Record<TaskKind, number> = { code: 8192, math: 4096, writing: 4096, research: 4096, general: 3072 };

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
