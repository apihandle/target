import { normalizeSite } from "@/lib/sessions";
import { reportLangHint, type Lang } from "@/lib/lang";

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

/**
 * The user's words with any login they typed into the chat taken out ("log in with tomsmith / SuperSecretPassword!",
 * "password: hunter2"). The browser fills the login from the vault; a typed password must never reach the browser
 * model's goal, its step notes or the job log.
 */
export function scrubCredentials(text: string): string {
  return (text ?? "")
    .replace(/\b(with|using|as|se)\s+\S+\s*\/\s*\S+/gi, "$1 the saved login")
    .replace(/(^|\s)[^\s/]+\s+\/\s+\S+/g, "$1[login hidden]")
    .replace(/(^|\s)[^\s./]+\/\S+(?=\s+(se|ke saath|login)\b)/gi, "$1[login hidden]")
    .replace(/\b(password|passwd|pass|pwd|pw|otp|pin)\b(\s*(is|=|:|-)?\s*)\S+/gi, "$1 [hidden]")
    .replace(/\b(username|user ?name|user|login id|email)\b\s*(is|=|:)\s*\S+/gi, "$1 [from the vault]");
}

/** The goal handed to the smart browser for a sign-in job. */
export function signinGoal(site: string, opts: { siteLogin?: string | null; googleLogin?: string | null; check?: string; lang?: Lang | null }): string {
  const how = opts.siteLogin
    ? `Sign in to ${site} with the saved login (vault item ${opts.siteLogin}): put the username/email with fill_secret field "username" and the password with fill_secret field "password".`
    : `Sign in to ${site} with its "Continue with Google" / "Sign in with Google" button, using the saved Google login (vault item ${opts.googleLogin}).`;
  const google = opts.googleLogin && opts.siteLogin ? ` If ${site} only offers Google sign-in, use the saved Google login (vault item ${opts.googleLogin}).` : "";
  const lang = reportLangHint(opts.lang);
  // The language hint goes last but is kept even when the rest is long.
  const main = [
    how + google,
    "Open the site's login page first if the start page is not it. If it is already signed in, skip to the report.",
    "If the page asks for a one-time code sent by email/SMS, use need_code on the code box.",
    "If Google shows a captcha, 'Couldn't sign you in', 'This browser or app may not be secure' or blocks the sign-in, use fail with a reason starting GOOGLE_BLOCKED.",
    "If the site says the username or password is wrong, use fail with a reason starting WRONG_LOGIN.",
    `When signed in, use done and report what the page shows (account name, balance, dashboard headings, key numbers)${opts.check ? ` and answer the user's ask: "${scrubCredentials(opts.check)}"` : ""}. Use the saved login only; once the page shows you are signed in, do not log out or sign in again. Do not change any settings.`,
  ].join(" ").slice(0, 1400);
  return lang ? `${main} ${lang}` : main;
}

/** Turn a failed sign-in job's reason into one short, plain line for the chat, in the user's language (Hinglish by default). */
export function signinFailure(error: string | null | undefined, site: string, lang?: Lang | null): { line: string; offerPassword: boolean } {
  const e = (error ?? "").trim();
  const en = lang === "english";
  const rest = e.replace(/^(GOOGLE_BLOCKED|WRONG_LOGIN|CLOUDFLARE_BLOCKED|NOT_SIGNED_IN)[:\s-]*/i, "").slice(0, 200);
  if (/GOOGLE_BLOCKED/i.test(e)) return { line: en ? `Google blocked the sign-in from this browser, so ${site} couldn't be signed in with Google.` : `Google ne is browser se sign-in block kar diya, isliye ${site} pe Google se login nahi hua.`, offerPassword: true };
  if (/WRONG_LOGIN/i.test(e)) return { line: en ? `${site} says the saved username or password is wrong.` : `${site} ne kaha ki saved username ya password galat hai.`, offerPassword: true };
  const tried = e.match(/\(tried (\d+) cloud browser/)?.[1];
  if (/STOPPED_BY_USER/.test(e)) return { line: en ? `You stopped the sign-in to ${site}.` : `Aapne ${site} ka sign-in rok diya.`, offerPassword: false };
  // The job paused with the live view and nobody finished the check in time.
  if (/nobody completed it within \d+ minutes/i.test(e)) return {
    line: en
      ? `${site}'s Cloudflare check needed you, and it wasn't completed within 5 minutes, so the sign-in did not happen. Ask again and tap Take control when the check shows.`
      : `${site} ka Cloudflare check aapke liye ruka tha, 5 minute mein poora nahi hua, isliye sign in nahi hua. Dobara bolo aur check dikhte hi Take control dabao.`,
    offerPassword: false,
  };
  if (/CLOUDFLARE_BLOCKED/i.test(e) || /cloudflare|turnstile|security check could not load|verify you are human/i.test(e)) return {
    line: en
      ? `${site}'s Cloudflare security check blocked the cloud browser, so the sign-in did not happen.${tried ? ` I waited, reloaded and tried ${tried} cloud browser sessions (stealth mode included); the check still didn't pass.` : ""} Free cloud browsers can't get past this check. Want me to try again later?`
      : `${site} ke Cloudflare security check ne cloud browser ko rok diya, isliye sign in nahi hua.${tried ? ` Maine wait aur reload kiya, ${tried} cloud browser sessions (stealth mode bhi) pe try kiya, check paas nahi hua.` : ""} Free cloud browsers ye check paar nahi kar paate. Thodi der baad dobara try karun?`,
    offerPassword: false,
  };
  if (/captcha/i.test(e)) return { line: en ? `${site} showed a captcha, so the sign-in stopped.` : `${site} ne captcha dikhaya, isliye sign-in ruk gaya.`, offerPassword: false };
  if (/NOT_SIGNED_IN/i.test(e)) return { line: en ? `Sign-in to ${site} didn't finish: ${rest || "the page still shows the login form"}.` : `${site} pe sign in nahi hua: ${rest || "page pe abhi bhi login form dikh raha hai"}.`, offerPassword: false };
  return { line: en ? `Sign-in to ${site} didn't finish: ${rest || "the browser stopped"}.` : `${site} pe sign-in poora nahi hua: ${rest || "browser ruk gaya"}.`, offerPassword: false };
}

/** The fixed status line the chat shows when the model can't write the sign-in reply itself. */
export function signinStatusLine(j: Record<string, unknown>, site: string, lang?: Lang | null): string {
  const status = typeof j.status === "string" ? j.status : "";
  const en = lang === "english";
  if (status === "needs_login") return en
    ? `\n\nThere's no saved login for ${site} yet. Save your email/username and password in the secure form below and I'll sign in right after.`
    : `\n\n${site} ka login abhi vault mein nahi hai. Neeche secure form mein email/username aur password save karo, save hote hi main sign in kar dunga.`;
  if (status === "needs_code") return en ? `\n\n${site} sent a code. Enter it below and I'll finish signing in.` : `\n\n${site} ne ek code bheja hai. Neeche code daalo, main sign-in poora kar dunga.`;
  if (status === "needs_you") return en ? `\n\n${site} shows a security check. Complete the check in the browser panel below, then tap Continue.` : `\n\n${site} pe security check aaya hai. Neeche browser panel mein check poora karo, phir Continue dabao.`;
  if (status === "signed_in") return `\n\n✓ ${en ? `Signed in to ${site}.` : `${site} pe sign in ho gaya.`}${typeof j.result === "string" && j.result ? `\n\n${j.result.slice(0, 1500)}` : ""}`;
  if (status === "failed") return `\n\n${typeof j.reason === "string" ? j.reason : en ? `Couldn't sign in to ${site}.` : `${site} pe sign-in nahi hua.`}`;
  if (status === "queued" || status === "running") return en ? `\n\nSigning in to ${site}; the result will be posted in this chat.` : `\n\n${site} pe sign in chal raha hai; result isi chat mein aa jayega.`;
  return "";
}

/**
 * The status headline the chat shows for a site_login result, rendered from the tool's status (never from the
 * model's words): success only for signed_in; a failure shows the reason. Empty for needs_login / needs_code / running.
 */
export function signinHeadline(j: Record<string, unknown>, site: string, lang?: Lang | null): string {
  const status = typeof j.status === "string" ? j.status : "";
  if (status === "signed_in") return signinPostHead(site, true, lang);
  if (status === "failed") return `${signinPostHead(site, false, lang)}\n\n${typeof j.reason === "string" && j.reason ? j.reason : lang === "english" ? "The sign-in didn't complete." : "Sign-in poora nahi hua."}`;
  return "";
}

/** Heading for a sign-in job's result posted into the chat later by the worker. */
export function signinPostHead(site: string, ok: boolean, lang?: Lang | null): string {
  if (lang === "english") return ok ? `✓ **Signed in to ${site}**` : `⚠️ **Couldn't sign in to ${site}**`;
  return ok ? `✓ **${site} pe sign in ho gaya**` : `⚠️ **${site} pe sign in nahi hua**`;
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
  "After the job runs, report what the signed-in page shows in 1-3 lines. " +
  "Only say the user is signed in / logged in / 'sign in ho gaya' when target__site_login returned status \"signed_in\". If it returned failed (Cloudflare check, wrong password, still on the login form) say plainly that the sign-in did NOT happen and why; never write a success headline or a ✓ for it.";
