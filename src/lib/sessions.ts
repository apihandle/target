/**
 * Website session (cookie) rules, shared by the server store and tests. Pure functions only.
 * A saved session only ever holds cookies that belong to its own site, so one site's login can
 * never be replayed on another.
 */
export type Cookie = {
  name: string; value: string; domain: string; path: string;
  expires: number; // unix seconds, -1 = session cookie
  httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None";
};
export type SessionVia = "google" | "email" | "password" | "other";
export const SESSION_COLS = "id, domain, account_email, via, cookie_count, status, expires_at, created_at, updated_at, last_used_at";

export const MAX_COOKIES = 150;
export const MAX_SESSION_BYTES = 96 * 1024;
export const SESSION_ONLY_TTL_DAYS = 14;
export const MAX_TTL_DAYS = 90;
export const MAX_SESSIONS_PER_USER = 100;

const NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/;

/** "https://www.Accounts.Example.com/x" -> "accounts.example.com"; null if not a public hostname. */
export function normalizeSite(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase();
  if (!h || h.length > 253) return null;
  if (/^[a-z]+:\/\//.test(h)) { try { h = new URL(h).hostname; } catch { return null; } }
  h = h.replace(/^\.+/, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
  if (/^\d+(\.\d+){3}$/.test(h) || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  return h;
}

/** Does a cookie's domain belong to this site (same host, a subdomain, or a parent of it)? */
export function cookieBelongsTo(cookieDomain: string, site: string): boolean {
  const d = cookieDomain.toLowerCase().replace(/^\./, "").replace(/^www\./, "");
  if (!d.includes(".")) return false; // never accept a cookie for a bare TLD like ".com"
  return d === site || d.endsWith("." + site) || site.endsWith("." + d);
}

/** Keep only well-formed, unexpired cookies for this site. Returns null if nothing usable is left. */
export function sanitizeCookies(raw: unknown, site: string, now = Date.now()): Cookie[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Cookie[] = [];
  let bytes = 0;
  for (const r of raw.slice(0, MAX_COOKIES * 2)) {
    if (!r || typeof r !== "object") continue;
    const c = r as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const value = typeof c.value === "string" ? c.value : "";
    const domain = typeof c.domain === "string" && c.domain ? c.domain : site;
    if (!NAME_RE.test(name) || value.length > 4096 || /[\r\n;]/.test(value)) continue;
    if (!cookieBelongsTo(domain, site)) continue;
    const expires = typeof c.expires === "number" && Number.isFinite(c.expires) ? Math.floor(c.expires) : -1;
    if (expires !== -1 && expires * 1000 <= now) continue;
    const sameSite = c.sameSite === "Strict" || c.sameSite === "None" ? c.sameSite : "Lax";
    const path = typeof c.path === "string" && c.path.startsWith("/") ? c.path.slice(0, 200) : "/";
    bytes += name.length + value.length + domain.length + path.length;
    if (bytes > MAX_SESSION_BYTES || out.length >= MAX_COOKIES) break;
    out.push({ name, value, domain: domain.toLowerCase(), path, expires, httpOnly: c.httpOnly !== false, secure: c.secure !== false, sameSite });
  }
  return out.length ? out : null;
}

/** When the saved session should be treated as expired: the latest cookie expiry, capped. */
export function sessionExpiry(cookies: Cookie[], now = Date.now()): Date {
  const cap = now + MAX_TTL_DAYS * 86400000;
  const latest = Math.max(...cookies.map((c) => (c.expires === -1 ? now + SESSION_ONLY_TTL_DAYS * 86400000 : c.expires * 1000)));
  return new Date(Math.min(latest, cap));
}

/** Cookies still valid right now (drops ones that expired after saving). */
export function liveCookies(cookies: Cookie[], now = Date.now()): Cookie[] {
  return cookies.filter((c) => c.expires === -1 || c.expires * 1000 > now);
}

export function cleanVia(v: unknown): SessionVia {
  return v === "google" || v === "email" || v === "password" ? v : "other";
}
