const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Only allow same-site relative redirects ("/app/x"), never "//evil.com" or "/\\evil.com". */
export function safeNext(v: string | null | undefined, fallback = "/app"): string {
  if (!v || typeof v !== "string") return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\r\n]/.test(v)) return fallback;
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
