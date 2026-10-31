/** Browser-side error reporting. Fire-and-forget, at most a few reports per page load, and duplicates are skipped. */
const seen = new Set<string>();
const MAX_PER_PAGE = 5;

export function sendErrorReport(err: unknown, extra?: { digest?: string }) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
    const message = `${e.message || "Unknown error"}${extra?.digest ? ` (digest ${extra.digest})` : ""}`.slice(0, 500);
    if (seen.has(message) || seen.size >= MAX_PER_PAGE) return;
    seen.add(message);
    const body = JSON.stringify({ message, stack: (e.stack ?? "").slice(0, 4000), url: location.pathname.slice(0, 500) });
    if (navigator.sendBeacon?.("/api/errors", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch { /* reporting must never throw */ }
}

/** For tests. */
export function resetClientErrors() { seen.clear(); }
