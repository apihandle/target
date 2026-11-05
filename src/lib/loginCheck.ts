/**
 * Telling a real sign-in from a page that only looks finished. Pure helpers shared by the browser worker,
 * the worker API (which turns an unverified "done" into a failure) and the chat (which renders the status
 * from the tool result, never from the model's wording).
 */

/** What the worker saw of a bot check on the page (Cloudflare challenge page or Turnstile widget). */
export type BotSignals = { title?: string; text?: string; frames?: string[]; widget?: boolean; solved?: boolean };
export type BotCheck = { kind: "page" | "widget"; line: string } | null;

/** Error / reason prefix the worker uses when a Cloudflare check stops the browser. */
export const CLOUDFLARE_BLOCKED = "CLOUDFLARE_BLOCKED";
/** Reason prefix for a "done" the server could not confirm as signed in. */
export const NOT_SIGNED_IN = "NOT_SIGNED_IN";

const CHALLENGE_TITLE = /^(just a moment|attention required|one more step|please wait|security check|access denied)\b|\|\s*cloudflare\b/i;
const CHALLENGE_TEXT = /(verify(ing)? you are (a )?human|checking (if the site connection is secure|your browser before)|security check could not load|needs to review the security of your connection|performing security verification|sorry, you have been blocked|enable javascript and cookies to continue|cf-chl|ray id: [0-9a-f]{8,})/i;
const CF_FRAME = /challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform/i;

/**
 * A Cloudflare check that is still unsolved. "page" = the whole page is a challenge or block page (nothing else
 * can be done); "widget" = a Turnstile box inside a form (the form can't be submitted until it passes).
 */
export function detectBotCheck(s: BotSignals): BotCheck {
  const title = (s.title ?? "").trim();
  const text = (s.text ?? "").slice(0, 6000);
  if (CHALLENGE_TITLE.test(title)) return { kind: "page", line: `Cloudflare security check page ("${title.slice(0, 60)}")` };
  // A short page that is mostly a challenge message is a challenge page; a long page that mentions it is a widget.
  if (CHALLENGE_TEXT.test(text) && text.replace(/\s+/g, " ").length < 1500) {
    const m = text.match(CHALLENGE_TEXT);
    return { kind: "page", line: `Cloudflare security check ("${(m?.[0] ?? "").slice(0, 60)}")` };
  }
  const framed = (s.frames ?? []).some((f) => CF_FRAME.test(f));
  if ((framed || s.widget) && !s.solved) return { kind: "widget", line: "Cloudflare Turnstile check on the form has not passed" };
  if (CHALLENGE_TEXT.test(text) && !s.solved) {
    const m = text.match(CHALLENGE_TEXT);
    return { kind: "widget", line: `Cloudflare security check on the page ("${(m?.[0] ?? "").slice(0, 60)}")` };
  }
  return null;
}

/** Text that says the sign-in did NOT happen, whatever headline came with it. */
const FAILED = /\b(login|log-in|sign[- ]?in|signin)\b[^.\n]{0,40}\b(not (completed|complete|successful|possible|done)|failed|unsuccessful|blocked|didn'?t (work|finish|complete)|did not (work|finish|complete)|incomplete)\b|\b(not|never|couldn'?t|could not|cannot|can'?t|unable to|failed to|wasn'?t able to|was not able to)\b[^.\n]{0,20}\b(log ?in|sign ?in|signed in|logged in|complete (the )?(login|sign[- ]?in))\b|\b(blocked|stopped|prevented)\b[^.\n]{0,40}\b(login|sign[- ]?in|signing in|logging in)\b|\b(cloudflare|turnstile|captcha|security check)\b[^.\n]{0,60}\b(fail|failed|blocked|blocking|could not|couldn'?t|didn'?t|not load|unsolved|required)|\b(still on the (login|sign[- ]?in) page|login form is still|wrong password|invalid (password|credentials|email or password|username))\b/i;

export function resultSaysFailed(text: string | null | undefined): boolean {
  return FAILED.test(text ?? "");
}

/** Buttons / links only a signed-in page has. */
const LOGGED_IN_EL = /^(log ?out|logout|sign ?out|signout|my account|my profile|profile|account|dashboard|settings|account settings)$|\b(log ?out|logout|sign ?out|signout)\b/i;
/** Weaker: words in the page text of a signed-in page. */
const LOGGED_IN_TEXT = /\b(log ?out|logout|sign ?out|welcome back|you logged into|logged in as|signed in as|my account|dashboard|account balance|your balance)\b/i;
const LOGIN_PATH = /(^|[/?#&=._-])(log[-_]?in|sign[-_]?in|auth|session\/new|sessions\/new|pg=login)([/?#&=._-]|$)/i;

export type LoginPage = {
  url: string; title?: string; text?: string;
  elements: { tag: string; type?: string; text?: string }[];
  bot?: { widget?: boolean; solved?: boolean; frames?: string[] };
};
export type LoginVerdict = { ok: true; evidence: string } | { ok: false; code: typeof CLOUDFLARE_BLOCKED | typeof NOT_SIGNED_IN; reason: string };

/**
 * Is the browser really signed in on this page? Signed in = no bot check pending AND the password form is gone
 * or a logged-in marker (log out, my account, dashboard...) is on the page. A visible password box with no
 * logged-in marker means the browser is still on the login form.
 */
export function verifyLogin(page: LoginPage, result?: string): LoginVerdict {
  const bot = detectBotCheck({ title: page.title, text: page.text, frames: page.bot?.frames, widget: page.bot?.widget, solved: page.bot?.solved });
  const hasPassword = page.elements.some((e) => (e.type ?? "").toLowerCase() === "password");
  const elMarker = page.elements.find((e) => LOGGED_IN_EL.test((e.text ?? "").trim()))?.text;
  if (bot && (bot.kind === "page" || hasPassword)) return { ok: false, code: CLOUDFLARE_BLOCKED, reason: `${bot.line}, so the login could not be completed` };
  if (result && resultSaysFailed(result) && !elMarker) {
    const cf = /cloudflare|turnstile|security check|verify you are human|captcha/i.test(result);
    return { ok: false, code: cf ? CLOUDFLARE_BLOCKED : NOT_SIGNED_IN, reason: firstSentence(result) };
  }
  if (hasPassword && !elMarker) return { ok: false, code: NOT_SIGNED_IN, reason: "the login form is still on the page" };
  if (elMarker) return { ok: true, evidence: `page has "${elMarker.trim().slice(0, 40)}"` };
  let path = "";
  try { const u = new URL(page.url); path = `${u.pathname}${u.search}${u.hash}`; } catch { path = page.url; }
  if (LOGIN_PATH.test(path)) return { ok: false, code: NOT_SIGNED_IN, reason: "the browser is still on the login page" };
  const textMarker = (page.text ?? "").match(LOGGED_IN_TEXT)?.[0];
  return { ok: true, evidence: textMarker ? `page shows "${textMarker}"` : "the login form is gone" };
}

function firstSentence(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  const m = s.match(/^(.{20,240}?[.!?])(\s|$)/);
  return (m ? m[1] : s.slice(0, 240)).trim();
}

/** The model's text claims the user is signed in (ignoring "not signed in" / "sign in nahi hua" phrasing). */
export function claimsSignedIn(text: string): boolean {
  const t = (text ?? "")
    .replace(/\b(not|n't|never|couldn'?t|could not|unable to|failed to|wasn'?t)\s+(been\s+|be\s+)?(signed|logged|sign|log)\s*in\b/gi, " ")
    .replace(/\b(sign[- ]?in|login|log[- ]?in)\s+(nahi|nahin|nhi|na)\b[^.\n]*/gi, " ")
    .replace(/\b(sign[- ]?in|login)\s+(poora|pura)\s+(nahi|nahin|nhi)\b/gi, " ");
  return /✓|✅|\b(signed in|logged in|sign[- ]?in (ho gaya|ho gya|hogaya|ho chuka|successful|complete[d]?|done)|login (ho gaya|ho gya|hogaya|ho chuka|successful|kar (liya|diya)|complete[d]?|done))\b/i.test(t);
}

export const NOT_CREATED = "ACCOUNT_NOT_CREATED";
export type SignupVerdict = { ok: true; evidence: string } | { ok: false; code: typeof CLOUDFLARE_BLOCKED | typeof NOT_CREATED; reason: string };
/** Words on a page right after a sign-up that went through. */
const CREATED_TEXT = /\b(account (has been |was )?created|successfully (registered|signed up|created)|registration (was )?(successful|complete)|thanks? (you )?for (registering|signing up)|welcome( aboard| to)?|verify your email|check your (email|inbox)|confirm your email|we('ve| have) sent (you )?(an? )?(email|link|code)|log ?out|sign ?out|my account|dashboard)\b/i;
/** Words a sign-up form shows when it refused the details. */
const SIGNUP_ERROR = /\b(already (exists|registered|taken|in use)|is already (registered|taken|in use)|is required|required field|do not match|don'?t match|invalid (email|username|password|phone)|password must|must (be|contain) at least|captcha (is )?(required|failed|incorrect)|please (try again|correct))\b/i;
const NOT_CREATED_TEXT = /\b(not|couldn'?t|could not|unable to|failed to|wasn'?t able to)\b[^.\n]{0,25}\b(create|register|sign ?up|make)\b|\b(sign ?up|registration|account creation)\b[^.\n]{0,30}\b(failed|blocked|did not|didn'?t|not (complete|completed|possible))\b/i;

/**
 * Did the sign-up really go through? Like verifyLogin: no bot check pending, no form error on the page, and the
 * sign-up form is gone or the page says the account exists / asks to verify the email.
 */
const CLEAR_SUCCESS = /\b(successfully (registered|signed up|created)|account (has been |was )?created|registration (was )?(successful|complete)|thanks? (you )?for (registering|signing up)|verify your email|check your (email|inbox)|confirm your email)\b/i;

/** The page plainly says a sign-up worked (and shows no form error): the phrase, else null. */
export function signupSucceeded(page: Pick<LoginPage, "title" | "text">): string | null {
  const text = `${page.title ?? ""}\n${page.text ?? ""}`;
  if (SIGNUP_ERROR.test(text)) return null;
  return text.match(CLEAR_SUCCESS)?.[0] ?? null;
}

export function verifySignup(page: LoginPage, result?: string): SignupVerdict {
  const bot = detectBotCheck({ title: page.title, text: page.text, frames: page.bot?.frames, widget: page.bot?.widget, solved: page.bot?.solved });
  const passwords = page.elements.filter((e) => (e.type ?? "").toLowerCase() === "password").length;
  if (bot && (bot.kind === "page" || passwords > 0)) return { ok: false, code: CLOUDFLARE_BLOCKED, reason: `${bot.line}, so the sign-up could not be completed` };
  if (result && NOT_CREATED_TEXT.test(result)) return { ok: false, code: NOT_CREATED, reason: firstSentence(result) };
  const text = `${page.title ?? ""}\n${page.text ?? ""}`;
  const err = text.match(SIGNUP_ERROR)?.[0];
  const created = text.match(CREATED_TEXT)?.[0];
  if (err && !created) return { ok: false, code: NOT_CREATED, reason: `the site says "${err}"` };
  if (created) return { ok: true, evidence: `page shows "${created}"` };
  if (passwords > 0) return { ok: false, code: NOT_CREATED, reason: "the sign-up form is still on the page" };
  return { ok: true, evidence: "the sign-up form is gone" };
}
