/**
 * Browser detection for sign-in. Google blocks OAuth inside app webviews (Instagram, Facebook,
 * LinkedIn, Snapchat, TikTok, Telegram, Line, generic Android WebView) with "disallowed_useragent".
 * We detect those and offer to open the page in the real browser instead of showing a Google error.
 */
export type InApp = { app: string; android: boolean; ios: boolean } | null;

const APPS: [RegExp, string][] = [
  [/Instagram/i, "Instagram"], [/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i, "Facebook"], [/LinkedInApp/i, "LinkedIn"],
  [/Snapchat/i, "Snapchat"], [/musical_ly|Bytedance|TikTok/i, "TikTok"], [/Telegram/i, "Telegram"],
  [/\bLine\//i, "Line"], [/Twitter|TwitterAndroid/i, "X"], [/Pinterest/i, "Pinterest"], [/GSA\//i, "Google app"],
];

export function detectInApp(ua: string): InApp {
  const android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua);
  for (const [re, app] of APPS) if (re.test(ua)) return { app, android, ios };
  if (android && /; wv\)/.test(ua)) return { app: "this app", android, ios };
  if (ios && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return { app: "this app", android, ios };
  return null;
}

/**
 * TARGET's own Android app: MainActivity appends "TargetAndroid/<version>" to the WebView
 * user agent. detectInApp also matches its WebView (the generic "; wv)" Android rule), but
 * sign-in DOES work there — the app intercepts /auth/google before the WebView loads it and
 * runs the Custom Tab + handoff flow — so the "open in your real browser" diversion in
 * GoogleButton must never fire for this UA. Without this exception the button bounced the
 * login page into Chrome, the whole sign-in ran as a plain web flow there, and the app
 * WebView was never signed in.
 */
export function isTargetApp(ua: string): boolean {
  return /\bTargetAndroid\//.test(ua);
}

/** Android: an intent URL opens the same page in Chrome (or the default browser). */
export function openInBrowserUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};action=android.intent.action.VIEW;end`;
}
