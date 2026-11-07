"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getTargetAndroid, type NextAlarm, type NotificationSummary, type TargetAndroidBridge } from "@/lib/targetAndroid";

export type VoiceState = "ready" | "listening" | "thinking" | "speaking";
export type AssistantMode = "normal" | "agent";
export type PhoneActionKind = "call" | "whatsapp" | "sms" | "alarm" | "timer" | "camera" | "flashlight" | "music";

export type AssistantState = {
  /** False only during the first client pass, while the bridge (if any) is being detected. */
  ready: boolean;
  /** True inside the Android app (window.TargetAndroid answered). Always false in a browser. */
  inApp: boolean;
  online: boolean;
  voice: VoiceState;
  /** Last final transcript heard this session, from the web mic or the native listener. */
  lastHeard: string | null;
  battery: { level: number; charging: boolean } | null;
  dnd: boolean | null;
  notifications: NotificationSummary | null;
  /** In-app only: this build can't read notifications (access not granted, or not exposed yet). */
  notificationsBlocked: boolean;
  nextAlarm: NextAlarm | null;
  wakeWord: boolean | null;
  canToggleWakeWord: boolean;
  appLock: boolean | null;
  sosAvailable: boolean;
  flashlightOn: boolean;
  mode: AssistantMode;
  hear: (text: string) => void;
  startListening: () => void;
  speak: (text: string) => void;
  phoneAction: (kind: PhoneActionKind) => void;
  toggleWakeWord: () => void;
  toggleMode: () => void;
  grantNotifications: () => void;
  triggerSos: () => Promise<void>;
};

const MODE_KEY = "target-home-mode";
const Ctx = createContext<AssistantState | null>(null);

function useAssistantStateImpl(): AssistantState {
  const [ready, setReady] = useState(false);
  const [inApp, setInApp] = useState(false);
  const [online, setOnline] = useState(true);
  const [voice, setVoice] = useState<VoiceState>("ready");
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [battery, setBattery] = useState<AssistantState["battery"]>(null);
  const [dnd, setDnd] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<NotificationSummary | null>(null);
  const [notificationsBlocked, setNotificationsBlocked] = useState(false);
  const [nextAlarm, setNextAlarm] = useState<NextAlarm | null>(null);
  const [wakeWord, setWakeWord] = useState<boolean | null>(null);
  const [canToggleWakeWord, setCanToggleWakeWord] = useState(false);
  const [appLock, setAppLock] = useState<boolean | null>(null);
  const [sosAvailable, setSosAvailable] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [mode, setMode] = useState<AssistantMode>("normal");
  const bridgeRef = useRef<TargetAndroidBridge | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const hear = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setLastHeard(t);
    setVoice("thinking");
    later(() => setVoice((v) => (v === "thinking" ? "ready" : v)), 900);
  }, [later]);

  const refreshPhone = useCallback(async (bridge: TargetAndroidBridge, first: boolean) => {
    try {
      const b = await bridge.battery();
      if (b?.ok && typeof b.level === "number") setBattery({ level: b.level, charging: !!b.charging });
    } catch { /* phone state is best-effort */ }
    if (!first) return;
    if (typeof bridge.doNotDisturb === "function") {
      try { const r = await bridge.doNotDisturb(); if (r?.ok && typeof r.on === "boolean") setDnd(r.on); } catch { /* optional */ }
    }
    if (typeof bridge.notifications === "function") {
      try {
        const r = await bridge.notifications();
        if (r?.ok && typeof r.total === "number") setNotifications({ total: r.total, byApp: r.byApp ?? {} });
        else setNotificationsBlocked(true);
      } catch { setNotificationsBlocked(true); }
    } else {
      setNotificationsBlocked(true);
    }
    if (typeof bridge.nextAlarm === "function") {
      try { const r = await bridge.nextAlarm(); if (r?.ok) setNextAlarm({ label: r.label ?? null, at: r.at ?? null, time: r.time ?? null }); } catch { /* optional */ }
    }
    if (typeof bridge.wakeWordEnabled === "function") {
      try { const r = await bridge.wakeWordEnabled(); if (r?.ok && typeof r.enabled === "boolean") setWakeWord(r.enabled); } catch { /* optional */ }
    }
    if (typeof bridge.appLockEnabled === "function") {
      try { const r = await bridge.appLockEnabled(); if (r?.ok && typeof r.enabled === "boolean") setAppLock(r.enabled); } catch { /* optional */ }
    }
  }, []);

  useEffect(() => {
    const timersAtMount = timers.current;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only APIs after mount so server and client markup match
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    try { if (window.localStorage.getItem(MODE_KEY) === "agent") setMode("agent"); } catch { /* private mode */ }

    const bridge = getTargetAndroid();
    if (!bridge) {
      setReady(true);
      return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
    }
    bridgeRef.current = bridge;

    const onListen = (e: Event) => {
      const d = (e as CustomEvent<{ ok?: boolean; text?: string; partial?: boolean }>).detail ?? {};
      if (d.partial && d.text) { setVoice("listening"); setLastHeard(d.text); return; }
      if (d.ok && d.text) { hear(d.text); return; }
      if (!d.ok) setVoice((v) => (v === "listening" ? "ready" : v));
    };
    window.addEventListener("target-listen", onListen);

    let interval: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      setCanToggleWakeWord(typeof bridge.setWakeWordEnabled === "function");
      setSosAvailable(typeof bridge.sos === "function");
      let ok = false;
      try { const v = await bridge.version(); ok = !!v?.ok; } catch { ok = false; }
      setInApp(ok);
      setReady(true);
      if (!ok) return;
      await refreshPhone(bridge, true);
      interval = setInterval(() => { void refreshPhone(bridge, false); }, 60_000);
    })();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("target-listen", onListen);
      if (interval) clearInterval(interval);
      timersAtMount.forEach(clearTimeout);
    };
  }, [hear, refreshPhone]);

  const startListening = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    setVoice("listening");
    void bridge.listen().then((r) => { if (!r?.ok) setVoice("ready"); }).catch(() => setVoice("ready"));
  }, []);

  const speak = useCallback((text: string) => {
    const bridge = bridgeRef.current;
    const t = text.trim();
    if (!bridge || !t) return;
    setVoice("speaking");
    void bridge.speak(t).catch(() => undefined);
    // TTS has no completion event on the bridge; estimate from length, then settle back to ready.
    later(() => setVoice((v) => (v === "speaking" ? "ready" : v)), Math.min(9000, Math.max(1500, 60 * t.length)));
  }, [later]);

  const phoneAction = useCallback((kind: PhoneActionKind) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    const run = (p: Promise<unknown>) => { void p.catch(() => undefined); };
    switch (kind) {
      case "call": run(bridge.openApp("phone")); break;
      case "whatsapp": run(bridge.openApp("whatsapp")); break;
      case "sms": run(bridge.composeSms("", "")); break;
      case "alarm": run(bridge.openApp("clock")); break;
      case "timer": run(bridge.openApp("clock")); break;
      case "camera": run(bridge.openApp("camera")); break;
      case "music": run(bridge.openApp("spotify")); break;
      case "flashlight": {
        const next = !flashlightOn;
        void bridge.flashlight(next).then((r) => { if (r?.ok) setFlashlightOn(next); }).catch(() => undefined);
        break;
      }
    }
  }, [flashlightOn]);

  const toggleWakeWord = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || typeof bridge.setWakeWordEnabled !== "function" || wakeWord === null) return;
    const next = !wakeWord;
    void bridge.setWakeWordEnabled(next).then((r) => { if (r?.ok) setWakeWord(next); }).catch(() => undefined);
  }, [wakeWord]);

  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === "agent" ? "normal" : "agent";
      try { window.localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const grantNotifications = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    if (typeof bridge.requestNotificationsAccess === "function") void bridge.requestNotificationsAccess().catch(() => undefined);
    else void bridge.openApp("settings").catch(() => undefined);
  }, []);

  const triggerSos = useCallback(async () => {
    const bridge = bridgeRef.current;
    if (bridge && typeof bridge.sos === "function") await bridge.sos().catch(() => undefined);
  }, []);

  return {
    ready, inApp, online, voice, lastHeard, battery, dnd, notifications, notificationsBlocked,
    nextAlarm, wakeWord, canToggleWakeWord, appLock, sosAvailable, flashlightOn, mode,
    hear, startListening, speak, phoneAction, toggleWakeWord, toggleMode, grantNotifications, triggerSos,
  };
}

/** Provides the one shared assistant state (bridge reads, voice state) to the home sections. */
export function AssistantStateProvider({ children }: { children: ReactNode }) {
  const state = useAssistantStateImpl();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useAssistantState(): AssistantState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useAssistantState must be used inside AssistantStateProvider");
  return s;
}
