/**
 * Live view of the cloud browser in chat, and who is in control of it. Shared by the worker, the API and the chat card.
 *
 * Interactive live views (checked 2026-11-04 with the real keys, free tiers):
 *   Steel        session debugUrl + ?interactive=true   (WebRTC player, frameable)
 *   Hyperbrowser liveUrl                                (noVNC, frameable)
 *   Anchor       live_view_url                          (needs credit; refused with "Insufficient credits balance")
 *   Browserbase  /sessions/{id}/debug debuggerFullscreenUrl
 *   Browserless  CDP Browserless.liveURL
 * Anything else falls back to screenshots refreshed every ~2 s plus the step log.
 */
export type LiveView = { provider: string; url: string; interactive: boolean };

/** Hosts a live-view URL may point at. Anything else is never put in an iframe. */
const LIVE_HOSTS = [/^api\.steel\.dev$/, /(^|\.)hxproxy\.io$/, /(^|\.)hyperbrowser\.ai$/, /(^|\.)anchorbrowser\.io$/, /(^|\.)browserbase\.com$/, /(^|\.)browserless\.io$/];

export function safeLiveUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 3000) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return LIVE_HOSTS.some((h) => h.test(url.hostname)) ? url.href : null;
  } catch { return null; }
}

/** Steel's player is view-only unless asked for interactive mode. */
export function steelLiveUrl(debugUrl: string): string {
  const u = new URL(debugUrl);
  u.searchParams.set("interactive", "true");
  u.searchParams.set("showControls", "false");
  return u.href;
}

/** The live view a provider's session response carries (null when it has none). */
export function liveViewFrom(provider: string, data: Record<string, unknown> | null | undefined): LiveView | null {
  if (!data) return null;
  const d = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  let raw: unknown = null;
  if (provider === "steel" && typeof d.debugUrl === "string") { try { raw = steelLiveUrl(d.debugUrl); } catch { raw = null; } }
  else if (provider === "hyperbrowser") raw = d.liveUrl;
  else if (provider === "anchor") raw = d.live_view_url;
  else if (provider === "browserbase") raw = d.debuggerFullscreenUrl ?? d.debuggerUrl;
  else if (provider === "browserless") raw = d.liveURL;
  const url = safeLiveUrl(raw);
  return url ? { provider, url, interactive: true } : null;
}

export type ViewMode = "iframe" | "screens" | "none";

/** What the chat card shows: the interactive live view while the job runs, else the latest screenshot. */
export function viewMode(job: { status: string; live?: Partial<LiveView> | null; frame?: string | null }): ViewMode {
  const running = job.status === "running";
  if (running && job.live?.interactive && safeLiveUrl(job.live.url)) return "iframe";
  return job.frame ? "screens" : "none";
}

/** Who drives the browser. "paused": the agent stopped and waits for the user; "user": the user has taken control. */
export type Control = "agent" | "paused" | "user" | "stop";
export type ControlEvent = "pause" | "take" | "continue" | "passed" | "timeout" | "stop";

/** The pause / take control state machine. Returns null when the move isn't allowed. */
export function nextControl(from: Control | null | undefined, ev: ControlEvent, opts: { interactive: boolean }): Control | null {
  const s: Control = from ?? "agent";
  if (s === "stop") return null;
  if (ev === "stop") return "stop";
  switch (s) {
    case "agent":
      if (ev === "pause" || ev === "take") return opts.interactive ? (ev === "pause" ? "paused" : "user") : null;
      return null;
    case "paused":
      if (ev === "take") return opts.interactive ? "user" : null;
      if (ev === "continue" || ev === "passed") return "agent";
      if (ev === "timeout") return "stop";
      return null;
    case "user":
      if (ev === "continue" || ev === "passed") return "agent";
      if (ev === "timeout") return "agent";
      if (ev === "pause") return "user";
      return null;
  }
}

/** How long the agent waits for the user (Cloudflare check, captcha, or the user's own take-over). */
export const PAUSE_MS = 5 * 60 * 1000;
export const CHECK_LINE = "Complete the check, then tap Continue";
export const STOPPED = "STOPPED_BY_USER";
export const PAUSE_TIMEOUT = "PAUSE_TIMEOUT";
