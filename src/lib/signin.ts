import { normalizeSite } from "@/lib/sessions";

/**
 * Signing in to websites for the user: pure helpers shared by the chat route, the site_login tool
 * and the browser worker. Passwords never pass through here; only vault item ids and site names do.
 */
export type VaultLoginRow = { id: string; kind: string; label: string; site: string | null };

const LOGIN_WORDS = /\b(log ?in|login|log-in|sign ?in|signin|sign-in|account (khol\w*|open)|login kar\w*|logged in)\b/i;
const GOOGLE_WORDS = /\b(google se|with google|via google|google (account|login|sign ?in)|continue with google|gmail se)\b/i;
const DOMAIN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|in|net|org|io|co|ai|app|dev|me|info|biz|xyz|gov|edu|us|uk|co\.in|tv|gg|site|online|store|shop)(?:\.[a-z]{2})?)\b(?:\/[^\s]*)?/i;

/** The user asking TARGET to sign in somewhere: "timebucks.com pe login karo", "sign in to github.com". */
export function loginIntent(text: string): { site: string; google: boolean } | null {
  const t = (text ?? "").slice(0, 2000);
  if (!LOGIN_WORDS.test(t)) return null;
  // "how do I log in", "login nahi ho raha" style questions about TARGET itself are still sign-in asks
  // only when a website is named; without one the chat just answers normally.
  const m = t.match(DOMAIN);
  const site = m ? normalizeSite(m[1].replace(/^https?:\/\//i, "")) : null;
  if (!site) return null;
  if (/(gettarget\.vercel\.app)$/.test(site)) return null;
  return { site, google: GOOGLE_WORDS.test(t) };
}

const GOOGLE_HOSTS = new Set(["google.com", "accounts.google.com", "gmail.com", "mail.google.com"]);
export const isGoogleSite = (s: string | null | undefined) => !!s && GOOGLE_HOSTS.has(normalizeSite(s) ?? "");

/** A vault login saved for this site (or a parent/sub domain of it). Matches the site field, else the label. */
export function matchLogin(items: VaultLoginRow[], site: string): VaultLoginRow | null {
  const want = normalizeSite(site);
  if (!want) return null;
  const logins = items.filter((i) => i.kind === "login");
  const same = (h: string | null) => !!h && (h === want || h.endsWith("." + want) || want.endsWith("." + h));
  return logins.find((i) => same(normalizeSite(i.site ?? ""))) ?? logins.find((i) => same(normalizeSite(i.label))) ??
    logins.find((i) => i.label.toLowerCase().includes(want.split(".")[0])) ?? null;
}

export const googleLogin = (items: VaultLoginRow[]) =>
  items.filter((i) => i.kind === "login").find((i) => isGoogleSite(i.site) || isGoogleSite(i.label) || /^google\b/i.test(i.label)) ?? null;

/** The goal handed to the smart browser for a sign-in job. */
export function signinGoal(site: string, opts: { siteLogin?: string | null; googleLogin?: string | null; check?: string }): string {
  const how = opts.siteLogin
    ? `Sign in to ${site} with the saved login (vault item ${opts.siteLogin}): put the username/email with fill_secret field "username" and the password with fill_secret field "password".`
    : `Sign in to ${site} with its "Continue with Google" / "Sign in with Google" button, using the saved Google login (vault item ${opts.googleLogin}).`;
  const google = opts.googleLogin && opts.siteLogin ? ` If ${site} only offers Google sign-in, use the saved Google login (vault item ${opts.googleLogin}).` : "";
  return [
    how + google,
    "Open the site's login page first if the start page is not it. If it is already signed in, skip to the report.",
    "If the page asks for a one-time code sent by email/SMS, use need_code on the code box.",
    "If Google shows a captcha, 'Couldn't sign you in', 'This browser or app may not be secure' or blocks the sign-in, use fail with a reason starting GOOGLE_BLOCKED.",
    "If the site says the username or password is wrong, use fail with a reason starting WRONG_LOGIN.",
    `When signed in, use done and report what the page shows (account name, balance, dashboard headings, key numbers)${opts.check ? ` and ${opts.check}` : ""}. Do not change any settings.`,
  ].join(" ").slice(0, 1400);
}

/** Turn a failed sign-in job's reason into one short, plain line for the chat. */
export function signinFailure(error: string | null | undefined, site: string): { line: string; offerPassword: boolean } {
  const e = (error ?? "").trim();
  if (/GOOGLE_BLOCKED/i.test(e)) return { line: `Google ne is browser se sign-in block kar diya, isliye ${site} pe Google se login nahi hua.`, offerPassword: true };
  if (/WRONG_LOGIN/i.test(e)) return { line: `${site} ne kaha ki saved username ya password galat hai.`, offerPassword: true };
  if (/captcha/i.test(e)) return { line: `${site} ne captcha dikhaya, isliye sign-in ruk gaya.`, offerPassword: false };
  return { line: `${site} pe sign-in poora nahi hua: ${e.replace(/^(GOOGLE_BLOCKED|WRONG_LOGIN)[:\s-]*/i, "").slice(0, 200) || "browser ruk gaya"}.`, offerPassword: false };
}

/** Pull a 4-8 character one-time code out of what the user typed ("code 482913", "482-913"). */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/[\s-]/g, "");
  return /^[A-Za-z0-9]{4,10}$/.test(t) ? t : null;
}

export const SIGNIN_PROMPT =
  "\n\nSIGNING IN TO WEBSITES: signing in to sites on the user's behalf is a core TARGET job, and the user owns the account. " +
  "When they ask you to log in / sign in / open their account on a site, call target__site_login with the site (method \"google\" when they say Google se / with Google). " +
  "It checks their vault; if no login is saved it shows a secure form under your reply, so just say in one short line that they can save the login there and you will sign in right after. " +
  "Never refuse, never lecture about phishing or security, never tell them to log in themselves, and never ask them to type a password or OTP into the chat (the secure form and code form handle that). " +
  "After the job runs, report what the signed-in page shows in 1-3 lines.";
