/**
 * Coarse, privacy-safe presence facts for the admin dashboard (pure; tested).
 * Country comes from Vercel's x-vercel-ip-country header (a 2-letter code); the IP is never read or stored.
 * Device is "OS · Browser" from the user agent; the user agent string itself is never stored.
 */
export function countryFrom(header: string | null | undefined): string | null {
  const c = (header ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

export function deviceFrom(ua: string | null | undefined): string | null {
  const s = ua ?? "";
  if (!s) return null;
  const os = /Android/i.test(s) ? "Android" : /iPhone|iPad|iPod/i.test(s) ? "iOS" : /Windows/i.test(s) ? "Windows" : /Mac OS X|Macintosh/i.test(s) ? "macOS" : /CrOS/i.test(s) ? "ChromeOS" : /Linux/i.test(s) ? "Linux" : "Other";
  const browser = /SamsungBrowser/i.test(s) ? "Samsung Internet" : /Edg\//i.test(s) ? "Edge" : /OPR\/|Opera/i.test(s) ? "Opera" : /Firefox|FxiOS/i.test(s) ? "Firefox" : /CriOS|Chrome\//i.test(s) ? "Chrome" : /Safari/i.test(s) ? "Safari" : "Other";
  return `${os} · ${browser}`;
}

/** Flag emoji for a 2-letter code (regional indicator symbols). */
export function flagOf(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

/** How often one user's presence row is refreshed (per server instance). */
export const PRESENCE_EVERY_MS = 5 * 60 * 1000;
