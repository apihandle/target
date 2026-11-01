/**
 * Keep signed-in users signed in. Rules (pure, so they can be tested):
 * - Only our own /api calls are retried, never other sites or the auth endpoints themselves.
 * - A 401 triggers one silent session refresh and one retry. Only if the refresh fails is the user
 *   sent to /login (and brought back to the same page afterwards).
 */
const SKIP = ["/api/auth", "/api/cron", "/api/site-sessions/worker", "/auth/"];

export function shouldRetryOn401(url: string, origin: string): boolean {
  try {
    const u = new URL(url, origin);
    if (u.origin !== origin) return false;
    if (!u.pathname.startsWith("/api/")) return false;
    return !SKIP.some((p) => u.pathname.startsWith(p));
  } catch { return false; }
}

export function loginUrl(path: string, search = ""): string {
  const next = (path || "/app") + (search || "");
  const safe = next.startsWith("/app") ? next : "/app";
  return `/login?next=${encodeURIComponent(safe)}&expired=1`;
}

/** A retry is only safe when the body can be sent again (not a one-shot stream). */
export function canReplay(init?: RequestInit): boolean {
  const b = init?.body;
  return b == null || typeof b === "string" || b instanceof URLSearchParams || (typeof FormData !== "undefined" && b instanceof FormData) || (typeof Blob !== "undefined" && b instanceof Blob);
}

type Refresh = () => Promise<boolean>;

/** Wrap fetch with the rules above. `refresh` resolves true when the session was renewed. */
export function withSessionRetry(base: typeof fetch, refresh: Refresh, origin: string, onExpired: () => void): typeof fetch {
  let pending: Promise<boolean> | null = null;
  const refreshOnce = () => (pending ??= refresh().finally(() => { pending = null; }));
  return async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (res.status !== 401 || !shouldRetryOn401(url, origin) || typeof input !== "string" && !(input instanceof URL) || !canReplay(init)) return res;
    const ok = await refreshOnce();
    if (!ok) { onExpired(); return res; }
    return base(input, init);
  };
}
