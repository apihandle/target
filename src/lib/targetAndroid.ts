/**
 * The Android bridge, `window.TargetAndroid`, installed by the native app's document-start shim
 * (see target-app's TargetBridge). Every method returns a Promise of a JSON result shaped
 * `{ ok: boolean, error?: string, ... }`. The bridge is absent in a normal browser, and older app
 * builds expose fewer methods — so every capability beyond the core set is optional here and
 * callers must feature-detect before use. Nothing in this file touches the DOM at import time.
 */

export type BridgeResult = { ok: boolean; error?: string };
export type BatteryResult = BridgeResult & { level?: number; charging?: boolean };
export type NotificationSummary = { total: number; byApp: Record<string, number> };
export type NextAlarm = { label: string | null; at: string | null; time: string | null };

export interface TargetAndroidBridge {
  version(): Promise<BridgeResult & { version?: string; platform?: string }>;
  openApp(name: string): Promise<BridgeResult>;
  dial(number: string): Promise<BridgeResult>;
  composeSms(number: string, text: string): Promise<BridgeResult>;
  setAlarm(hour: number, minute: number, label?: string | null): Promise<BridgeResult>;
  setTimer(seconds: number, label?: string | null): Promise<BridgeResult>;
  flashlight(on: boolean): Promise<BridgeResult & { on?: boolean }>;
  openUrl(url: string): Promise<BridgeResult>;
  navigate(place: string): Promise<BridgeResult>;
  share(text: string): Promise<BridgeResult>;
  battery(): Promise<BatteryResult>;
  takePendingImage(): Promise<BridgeResult>;
  speak(text: string): Promise<BridgeResult>;
  /** Transcript arrives later as a `target-listen` CustomEvent (and via window[callbackName]). */
  listen(callbackName?: string): Promise<BridgeResult & { started?: boolean }>;

  /* Optional: only present on app builds that expose these. Feature-detect with typeof. */
  wakeWordEnabled?: () => Promise<BridgeResult & { enabled?: boolean }>;
  setWakeWordEnabled?: (on: boolean) => Promise<BridgeResult>;
  doNotDisturb?: () => Promise<BridgeResult & { on?: boolean }>;
  notifications?: () => Promise<BridgeResult & Partial<NotificationSummary>>;
  requestNotificationsAccess?: () => Promise<BridgeResult>;
  nextAlarm?: () => Promise<BridgeResult & Partial<NextAlarm>>;
  appLockEnabled?: () => Promise<BridgeResult & { enabled?: boolean }>;
  sos?: () => Promise<BridgeResult>;
}

/** The bridge object, or null in a browser / old WebView where the shim never ran. */
export function getTargetAndroid(w: unknown = typeof window !== "undefined" ? window : undefined): TargetAndroidBridge | null {
  const bridge = (w as { TargetAndroid?: unknown } | undefined)?.TargetAndroid;
  if (!bridge || typeof bridge !== "object") return null;
  const b = bridge as Partial<TargetAndroidBridge>;
  return typeof b.version === "function" && typeof b.battery === "function" ? (b as TargetAndroidBridge) : null;
}

/** "3 new WhatsApp messages", "1 new Gmail message", "5 new notifications". */
export function notificationHeadline(n: NotificationSummary): string {
  const apps = Object.entries(n.byApp).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (n.total <= 0) return "No new notifications";
  if (apps.length === 1) {
    const [app, count] = apps[0];
    return `${count} new ${app} message${count === 1 ? "" : "s"}`;
  }
  return `${n.total} new notification${n.total === 1 ? "" : "s"}`;
}

/** One clean line from a chat message: no markdown, no code fences, capped length. */
export function oneLine(text: string, max = 140): string {
  const clean = text.replace(/```(actions?|sources)?[\s\S]*?```/gi, " ").replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
