import { randomInt } from "crypto";
import { normalizeSite } from "@/lib/sessions";
import { reportLangHint, type Lang } from "@/lib/lang";

/**
 * Creating an account or resetting a password on a website for the user. Server-only helpers.
 * The new password is generated here, sealed straight into the vault and typed by the browser with
 * fill_secret: it is never shown in chat, logs, job results or the approval card.
 */
export type AccountFlow = "register" | "reset";
export type AccountInputs = { flow: AccountFlow; site: string; email: string; vault_id?: string; replaces?: string | null; details?: string; lang?: Lang | null; goal?: string };

const DOMAIN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24})\b/i;
const RESET = [
  /\b(password|passwd|pwd|pass)\b.{0,40}\b(reset|change|badal\w*|bhul\w*|bhool\w*|forgot|forget|recover|naya|new)\b/i,
  /\b(reset|change|badal\w*|forgot|forget|recover|bhul\w*|bhool\w*)\b.{0,40}\b(password|passwd|pwd)\b/i,
];
const SIGNUP = [
  /\b(sign ?up|signup|register|registration)\b/i,
  /\b(new|naya|nayi|ek)\s+(account|a\/c|id)\b/i,
  /\b(account|a\/c|id)\b.{0,25}\b(bana\w*|create|make|banwa\w*)\b/i,
  /\b(create|make|bana\w*)\b.{0,25}\b(account|a\/c|id)\b/i,
];

function siteIn(text: string): string | null {
  const m = text.match(DOMAIN);
  const s = m ? normalizeSite(m[1].replace(/^https?:\/\//i, "")) : null;
  return s && !/gettarget\.vercel\.app$/.test(s) ? s : null;
}

/** The user's own message explicitly asks to reset/change their password on a named site. */
export function resetIntent(text: string | null | undefined): { site: string } | null {
  const t = (text ?? "").slice(0, 2000);
  if (!RESET.some((r) => r.test(t))) return null;
  const site = siteIn(t);
  return site ? { site } : null;
}

/** The user's own message explicitly asks to create a new account on a named site. */
export function signupIntent(text: string | null | undefined): { site: string } | null {
  const t = (text ?? "").slice(0, 2000);
  if (!SIGNUP.some((r) => r.test(t))) return null;
  const site = siteIn(t);
  return site ? { site } : null;
}

const sameSite = (a: string | null, b: string | null) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));

/**
 * Did the user ask for this flow on this site in one of their own recent messages (the latest, or the one or two
 * before it when TARGET asked a follow-up question such as which email)? Server check: the model can't start these on its own.
 */
export function userAsked(flow: AccountFlow, site: string, userTexts: string[] | null | undefined): boolean {
  const want = normalizeSite(site);
  return (userTexts ?? []).slice(-3).some((t) => {
    const i = flow === "reset" ? resetIntent(t) : signupIntent(t);
    return !!i && sameSite(i.site, want);
  });
}

const LOWER = "abcdefghjkmnpqrstuvwxyz", UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ", DIGITS = "23456789", SYMBOLS = "!@#$%^&*-_+=?";

/** A strong random password (20 chars, every class, no look-alike characters), from the OS CSPRNG. */
export function generatePassword(length = 20): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

/** Goal for the smart browser. Deliberately avoids the words "sign in" so the login autofill stays out of it. */
export function accountGoal(a: AccountInputs & { vault_id: string }): string {
  const secret = `vault item ${a.vault_id}`;
  const common = [
    "Every password box (new password and confirm password) takes fill_secret field \"password\" from that vault item; never type a password yourself.",
    "If the site emails a one-time code, use need_code on the code box. If it emails a link instead (verify email / reset password), use need_link and continue on the page it opens.",
    "If there is a captcha or a check you can't pass, use need_user when that action is offered (the user takes control and finishes it), otherwise fail. If the site asks for information you were not given (phone number, date of birth, ID), use fail and say exactly what is needed.",
    "Never pay, subscribe, or accept anything optional (newsletters, offers).",
  ];
  const steps = a.flow === "reset"
    ? [
        `Reset the password of the user's own account on ${a.site} (account email ${a.email}) using the site's "Forgot password" flow.`,
        `Open the login page, choose Forgot / Reset password, enter ${a.email}, and submit.`,
        `Set the new password from ${secret}.`,
        ...common,
        "Use done only when the site confirms the password was changed, and say what it showed.",
      ]
    : [
        `Create a new account for the user on ${a.site} using the email ${a.email} and the password from ${secret} (fill_secret field "username" can fill the email).`,
        `Open the site's Sign up / Register / Create account page.${a.details ? ` Details the user gave for the form: ${a.details.replace(/\s+/g, " ").slice(0, 300)}.` : ""}`,
        "Accept only the required terms checkbox.",
        ...common,
        "Use done only when the account exists (verification finished or the site says to verify later), and say what the page shows.",
      ];
  const hint = reportLangHint(a.lang);
  return `${steps.join(" ").slice(0, 1600)}${hint ? ` ${hint}` : ""}`;
}

export function accountSummary(a: Pick<AccountInputs, "flow" | "site" | "email"> & { name?: string | null }): string {
  return (a.flow === "reset" ? `Reset your password on ${a.site} (account ${a.email})` : `Create a new account on ${a.site} with ${a.email}${a.name ? ` (name ${a.name})` : ""}. A strong password is generated and saved in your vault`).slice(0, 300);
}

/** "name X" for the form, from the user's own profile, unless the user already gave a name. */
export function withProfileName(details: string | undefined, name: string | null | undefined): string | undefined {
  const n = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!n || /\bname\b/i.test(details ?? "")) return details;
  return [details, `name ${n}`].filter(Boolean).join("; ").slice(0, 300);
}

/** Read { account } out of a browser job's inputs. */
export function accountOf(inputs: unknown): AccountInputs | null {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return null;
  const a = (inputs as { account?: Record<string, unknown> }).account;
  if (!a || (a.flow !== "reset" && a.flow !== "register") || typeof a.site !== "string" || typeof a.email !== "string") return null;
  return {
    flow: a.flow, site: a.site, email: a.email,
    vault_id: typeof a.vault_id === "string" ? a.vault_id : undefined,
    replaces: typeof a.replaces === "string" ? a.replaces : null,
    details: typeof a.details === "string" ? a.details : undefined,
    lang: a.lang === "hinglish" || a.lang === "hindi" || a.lang === "english" ? a.lang : null,
    goal: typeof a.goal === "string" ? a.goal : undefined,
  };
}

/** Heading + line for the chat message posted when an account job finishes. */
export function accountPost(a: Pick<AccountInputs, "flow" | "site" | "lang">, ok: boolean): string {
  const en = a.lang === "english";
  if (a.flow === "reset") {
    if (ok) return en ? `✓ **Password changed on ${a.site}.** The new password is saved in your vault (it isn't shown here).` : `✓ **${a.site} ka password badal gaya.** Naya password vault mein save hai (yahan dikhaya nahi jayega).`;
    return en ? `⚠️ **Password reset on ${a.site} didn't finish.**` : `⚠️ **${a.site} ka password reset poora nahi hua.**`;
  }
  if (ok) return en ? `✓ **Account created on ${a.site}.** The login is saved in your vault, so I can sign in for you next time.` : `✓ **${a.site} pe naya account ban gaya.** Login vault mein save hai, agli baar main sign in kar dunga.`;
  return en ? `⚠️ **Account creation on ${a.site} didn't finish.**` : `⚠️ **${a.site} pe account banana poora nahi hua.**`;
}
