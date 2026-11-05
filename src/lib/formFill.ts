/**
 * Form filling truth (third-party forms such as Google Forms): which jobs submit a form, whether the page really
 * confirms the submit, whether the fields the goal names hold the goal's values before Next / Submit, and a report
 * built only from what the page showed (never from the goal text).
 */

/** One question on the page as the browser read it back: label, current value, and what kind of control it is. */
export type FormField = { q: string; v: string; kind?: "text" | "choice" | "multi" | "select" };

const FORM_HOST = /^https?:\/\/(docs\.google\.com\/forms|forms\.gle|forms\.office\.com|[\w-]+\.typeform\.com|form\.typeform\.com|[\w.-]*jotform\.com|[\w.-]*surveymonkey\.com|tally\.so|[\w.-]*formstack\.com|airtable\.com\/shr)/i;
const SUBMIT_WORDS = /\b(submit|send)\b[^.]{0,80}\b(form|survey|questionnaire|application|response|answers|feedback|entry|rsvp)\b|\b(form|survey|questionnaire|application|rsvp)\b[^.]{0,120}\b(submit|send)\b|\b(fill|complete|answer)\b[^.]{0,40}\b(form|survey|questionnaire|application)\b/i;

/** A job whose goal is to fill in and submit someone else's form (needs approval in normal mode, a confirmation to count as done). */
export function isFormSubmitGoal(goal: string, startUrl = ""): boolean {
  if (/^(Create a new account for the user on|Reset the password of the user's own account|Sign in)/i.test(goal)) return false;
  if (!/\b(submit|send|fill|complete|answer)\b/i.test(goal)) return false;
  return FORM_HOST.test(startUrl) || FORM_HOST.test(goal.match(/https?:\/\/\S+/)?.[0] ?? "") || SUBMIT_WORDS.test(goal);
}

/** What a form shows after a real submit. A page that still has a Submit button doesn't count. */
const CONFIRM_RE = /your response has been recorded|response (was|has been) (recorded|submitted|received)|thank(s| you)( so much)?( for| -|!|,|\.|\s*$)|submitted successfully|successfully submitted|submission (received|successful|complete)|(form|survey|entry|application|answers?|feedback|rsvp) (was |has been )?(submitted|sent|received)|we('ve| have) received your|\bsubmitted\b/im;

export function submissionConfirmed(page: { text: string; title?: string; elements?: { tag: string; type?: string; text: string }[] }): string | null {
  const text = `${page.title ?? ""}\n${page.text}`;
  const m = text.match(CONFIRM_RE);
  if (!m) return null;
  // Page 2 of a form with a pending Submit button isn't a confirmation, even if its description says "submitted".
  const stillSubmit = (page.elements ?? []).some((e) => (e.tag === "button" || e.type === "submit" || e.tag === "div" || e.tag === "span") && /^\s*submit\s*$/i.test(e.text));
  if (stillSubmit) return null;
  const line = text.split(/\n/).find((l) => CONFIRM_RE.test(l)) ?? m[0];
  return line.replace(/\s+/g, " ").trim().slice(0, 140);
}

/** A click on a form's Next / Submit button: the moment to check the fields first. */
export function advanceKind(text: string): "next" | "submit" | null {
  const t = text.split(" = ")[0].replace(/\s+/g, " ").trim();
  if (/^(next|next page|continue to next page|weiter|aage)$/i.test(t)) return "next";
  if (/^(submit|submit form|submit response|submit answers|send|send form|send response|finish|done)$/i.test(t)) return "submit";
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[*“”"'’`]/g, "").replace(/[^a-z0-9\u0900-\u097f@.]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1 && !/^(the|a|an|of|to|do|you|your|is|in|on|for|with|at)$/.test(w)));

/** "Label = value" pairs the goal names ("Your name = Asha; Favourite colour = Blue; ..."). */
export function goalPairs(goal: string): { label: string; want: string }[] {
  const out: { label: string; want: string }[] = [];
  for (const seg of goal.split(/;|\n|\.\s+(?=[A-Z])/)) {
    const k = seg.indexOf("=");
    if (k < 0) continue;
    let label = seg.slice(0, k);
    const colon = label.lastIndexOf(": ");
    if (colon >= 0) label = label.slice(colon + 2);
    label = label.replace(/^\s*(and|then)\s+/i, "").trim();
    const want = seg.slice(k + 1).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
    if (label && want && label.length <= 160 && want.length <= 300) out.push({ label, want });
  }
  return out;
}

function fieldFor(label: string, fields: FormField[]): FormField | null {
  const lw = words(label);
  if (!lw.size) return null;
  let best: FormField | null = null, score = 0;
  for (const f of fields) {
    const fw = words(f.q);
    let hit = 0;
    for (const w of lw) if (fw.has(w)) hit++;
    const s = hit / lw.size;
    if (s > score) { score = s; best = f; }
  }
  return score >= 0.6 ? best : null;
}

const parts = (v: string) => v.split(/\s*(?:,|\band\b|&|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);

/**
 * Fields on this page that don't hold what the goal says (a checkbox left unticked, a box still empty). Only the
 * questions on the current page are checked; questions on other pages are ignored.
 */
export function missingFields(goal: string, fields: FormField[] | undefined): string[] {
  if (!fields?.length) return [];
  const out: string[] = [];
  for (const { label, want } of goalPairs(goal)) {
    const f = fieldFor(label, fields);
    if (!f) continue;
    const have = norm(f.v);
    if (f.kind === "multi") {
      const wanted = parts(want);
      const ticked = parts(f.v);
      const missing = wanted.filter((w) => !ticked.some((t) => norm(t) === norm(w)));
      const extra = /\bonly\b/i.test(goal) ? ticked.filter((t) => !wanted.some((w) => norm(t) === norm(w))) : [];
      if (missing.length || extra.length) out.push(`"${f.q}" should be ${wanted.join(" + ")} but the page shows ${ticked.length ? ticked.join(" + ") : "nothing ticked"}`);
    } else if (!have || (!have.includes(norm(want)) && !norm(want).includes(have))) {
      out.push(`"${f.q}" should be "${want}" but the page shows ${have ? `"${f.v}"` : "nothing"}`);
    }
  }
  return out;
}

/** How many "label = value" pairs in the goal match a question on this page. */
export function matchedPairs(goal: string, fields: FormField[] | undefined): number {
  if (!fields?.length) return 0;
  return goalPairs(goal).filter(({ label }) => fieldFor(label, fields)).length;
}

/** Merge a page's read-back into what was recorded before (latest value per question wins). */
export function mergeReadback(prev: FormField[] | undefined, page: FormField[] | undefined): FormField[] {
  const out = [...(prev ?? [])];
  for (const f of page ?? []) {
    const k = out.findIndex((x) => norm(x.q) === norm(f.q));
    if (k >= 0) out[k] = f; else out.push(f);
  }
  return out.slice(0, 60);
}

/** The final report: only the confirmation the page showed, the values read back from the page, and the step log. */
export function formReport(opts: { confirmed: string | null; readback: FormField[]; log: string[]; url: string; reason?: string }): string {
  const steps = opts.log.filter((l) => /^(click|fill|select|press|goto|scroll)\b/.test(l)).length;
  const head = opts.confirmed
    ? `Submitted. The page confirmed it: “${opts.confirmed}”.`
    : `Not submitted: the page never showed a confirmation${opts.reason ? ` (${opts.reason})` : ""}.`;
  const rows = opts.readback.length
    ? ["What the form showed before each Next / Submit (read back from the page):", "", "| Question | Answer on the page |", "|---|---|",
      ...opts.readback.map((f) => `| ${f.q.replace(/\|/g, "/").slice(0, 100)} | ${(f.v || "(empty)").replace(/\|/g, "/").slice(0, 160)} |`)].join("\n")
    : "No field values were read back from the page.";
  return `${head}\n\n${rows}\n\nSteps: ${steps} browser actions. Final page: ${opts.url.slice(0, 200)}`;
}

export const NOT_SUBMITTED = "NOT_SUBMITTED";
