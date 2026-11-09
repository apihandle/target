const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Only allow same-site relative redirects ("/app/x"), never "//evil.com" or "/\\evil.com". */
export function safeNext(v: string | null | undefined, fallback = "/app"): string {
  if (!v || typeof v !== "string") return fallback;
  // Judge the percent-decoded form: "/%09/evil.com" and "/%5cevil.com" look harmless raw, but a
  // browser that strips the tab (or treats the backslash as a slash) lands on "//evil.com".
  // Any control character anywhere in the decoded value disqualifies it. (Security audit 2026-11-09, #7.)
  let decoded: string;
  try { decoded = decodeURIComponent(v); } catch { return fallback; }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  return v;
}

/** Collapse whitespace and cap length; returns "" for non-strings. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Like cleanText but keeps line breaks (for notes/bodies). */
export function cleanMultiline(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : "";
}
