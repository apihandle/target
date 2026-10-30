import { cleanMultiline, cleanText } from "@/lib/ids";

/** Prompt templates: built-ins plus the user's own (prompt_templates table). A template only fills the composer. */
export type PromptTemplate = { id: string; title: string; prompt: string; builtin?: boolean };

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  { id: "builtin-blog", builtin: true, title: "Write a blog post", prompt: "Write a blog post about [topic] for [audience]. Aim for about 800 words, a clear structure with headings, a strong intro and a practical takeaway at the end." },
  { id: "builtin-code-review", builtin: true, title: "Code review", prompt: "Review this code. Point out bugs, security issues, performance problems and readability improvements, most important first, with corrected snippets:\n\n```\n[paste code]\n```" },
  { id: "builtin-summarize", builtin: true, title: "Summarize", prompt: "Summarize the following in 5 bullet points, then give a one-line TL;DR:\n\n[paste text, or attach a file]" },
  { id: "builtin-email", builtin: true, title: "Email draft", prompt: "Draft a [polite/friendly/formal] email to [who] about [what]. Keep it short and clear, with a subject line." },
];

export const MAX_USER_TEMPLATES = 50;
export const TEMPLATE_COLS = "id, title, prompt, created_at, updated_at";

export function validateTemplate(input: Record<string, unknown>, partial = false): { ok: true; value: { title?: string; prompt?: string } } | { ok: false; error: string; field?: string } {
  const value: { title?: string; prompt?: string } = {};
  if (!partial || input.title !== undefined) {
    const title = cleanText(input.title, 61);
    if (!title) return { ok: false, error: "Give the template a name", field: "title" };
    if (title.length > 60) return { ok: false, error: "Name is too long (60 max)", field: "title" };
    value.title = title;
  }
  if (!partial || input.prompt !== undefined) {
    const prompt = cleanMultiline(input.prompt, 4001);
    if (!prompt) return { ok: false, error: "The template needs some text", field: "prompt" };
    if (prompt.length > 4000) return { ok: false, error: "Template is too long (4000 max)", field: "prompt" };
    value.prompt = prompt;
  }
  if (partial && !Object.keys(value).length) return { ok: false, error: "Nothing to update" };
  return { ok: true, value };
}
