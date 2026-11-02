/**
 * Quick turns: small talk and short questions that need no tools, links, files or live data. These skip the tool
 * list and the long feature prompt and go to a fast model with thinking off, so "hi" answers in a second or two.
 * Anything that might need a tool, an account, a sign-in, the web or a long answer takes the full path.
 */

// Words that hint at a tool, an account, an app feature, live data or real work. Kept broad on purpose:
// a false "not quick" only costs a few seconds; a false "quick" would lose the tools.
const NEEDS_WORK = new RegExp(
  "\\b(" + [
    // making things
    "bana\\w*", "create", "make", "generate", "draw", "design", "build", "edit", "convert", "chart", "graph", "plot", "image", "photo", "pic",
    "logo", "poster", "pdf", "csv", "excel", "sheet", "file", "page", "site", "website", "app", "video", "youtube", "reel", "transcript",
    // accounts and actions
    "log\\s*in", "login", "sign\\s*in", "signin", "sign\\s*up", "account", "password", "vault", "email", "mail", "gmail", "inbox", "calendar", "drive",
    "doc", "docs", "github", "repo", "notion", "slack", "vercel", "supabase", "figma", "canva", "send", "bhej\\w*", "post", "tweet", "share", "book",
    "order", "buy", "kharid\\w*", "checkout", "pay", "payment", "browser", "open", "khol\\w*", "click", "download", "upload",
    // app features
    "remind\\w*", "reminder", "yaad", "remember", "alarm", "task", "todo", "to-do", "schedule", "project", "panel", "memory", "note",
    // live data and research
    "search", "google", "dhoo?ndh?\\w*", "find", "news", "latest", "today", "aaj", "abhi", "price", "rate", "weather", "mausam", "score",
    "stock", "crypto", "bitcoin", "compare", "research", "review", "best", "top",
    // real work that deserves the strong model
    "code", "coding", "program", "script", "bug", "error", "debug", "sql", "api", "deploy", "calculate", "solve", "math", "essay", "letter",
    "application", "resume", "cv", "plan", "itinerary", "recipe", "translate", "summari[sz]e", "explain", "likh\\w*", "write", "draft", "run", "check",
  ].join("|") + ")\\b",
  "i",
);

export type QuickContext = { hasAttachments?: boolean; hasTask?: boolean; webRequested?: boolean; resume?: boolean; regenerate?: boolean };

/** True for small talk and short, self-contained questions that a fast model can answer well without tools. */
export function isQuickTurn(text: string, ctx: QuickContext = {}): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 160) return false;
  if (ctx.hasAttachments || ctx.hasTask || ctx.webRequested || ctx.resume) return false;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|app|dev|ai|co)\b/i.test(t)) return false;
  if (/```|\n.*\n/.test(t)) return false; // code or a multi-line ask
  if (/\d+\s*[-+*/^×÷%]\s*\d+/.test(t)) return false; // arithmetic
  if ((t.match(/\?/g) ?? []).length > 1) return false; // several questions
  return !NEEDS_WORK.test(t);
}

/** Short system prompt for a quick turn: who TARGET is and how to talk, without the tool and card catalogue. */
export const QUICK_PROMPT =
  "\n\nThis is a quick conversational turn: reply naturally and briefly (one to four short sentences, or a few bullets if the question needs it). " +
  "Match the user's language (Hinglish if they write Hinglish). Don't list your features unless asked. If the user actually needs an action " +
  "(a file, a search, a sign-in, a reminder), tell them in one line that you can do it if they ask.";
