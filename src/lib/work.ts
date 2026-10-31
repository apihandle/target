/** Rules for the Work page, shared by the API and the UI. */
export const WORK_COOLDOWN_SEC = 180; // the same link can be opened again after 3 minutes
export const WORK_MIN_STAY_SEC = 15; // stay on the ad at least this long for the coins to count
export const WORK_CLAIM_WINDOW_SEC = 60 * 60; // a view must be claimed within an hour

export type WorkLink = { id: string; title: string; url: string; coins: number };

/** Seconds left before this link can be opened again, given when it was last opened. */
export function cooldownLeft(lastStartedAt: string | null | undefined, now = Date.now()): number {
  if (!lastStartedAt) return 0;
  const left = WORK_COOLDOWN_SEC - Math.floor((now - Date.parse(lastStartedAt)) / 1000);
  return left > 0 ? left : 0;
}

export function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 10 || v.length > 1000) return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
}
