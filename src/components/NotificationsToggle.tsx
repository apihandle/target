"use client";
import { useEffect, useState } from "react";
import { APP_SW_SCOPE, APP_SW_URL } from "@/components/PwaRegister";

type State = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration(APP_SW_SCOPE)) ?? (await navigator.serviceWorker.register(APP_SW_URL, { scope: APP_SW_SCOPE }));
}

/** Turn phone notifications on or off for this device, and send a test. */
export default function NotificationsToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone only allows notifications once the app is added to the Home Screen.
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") { setState("blocked"); return; }
      try {
        const reg = await navigator.serviceWorker.getRegistration(APP_SW_SCOPE);
        const sub = await reg?.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch { setState("off"); }
    })();
  }, []);

  async function turnOn() {
    setBusy(true); setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) { await sub.unsubscribe(); throw new Error(); }
      setState("on");
      setNote("Notifications are on for this device.");
    } catch {
      setNote("Couldn't turn on notifications. Try again.");
    } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true); setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(APP_SW_SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setNote("Couldn't turn off notifications. Try again.");
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setNote(r.ok ? (j.sent ? "Test sent. It should arrive in a few seconds." : "No device got it. Turn notifications off and on again.") : j.error || "Couldn't send a test.");
    } finally { setBusy(false); }
  }

  const btn = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";
  return (
    <div className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="notifications-toggle" data-state={state}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">Phone notifications</p>
          <p className="mt-0.5 text-sm text-muted">
            {state === "on" && "On for this device."}
            {state === "off" && "Get an alert when scheduled work is done."}
            {state === "loading" && "Checking this device..."}
            {state === "blocked" && "Blocked in your browser settings. Allow notifications for this site, then come back."}
            {state === "unsupported" && "This browser can't show notifications."}
            {state === "needs-install" && "On iPhone, first add TARGET to your Home Screen (Share, then Add to Home Screen), open it from there, and turn this on."}
          </p>
        </div>
        {(state === "on" || state === "off") && (
          <button type="button" role="switch" aria-checked={state === "on"} aria-label="Phone notifications" disabled={busy} data-testid="notif-switch"
            onClick={state === "on" ? turnOff : turnOn}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${state === "on" ? "bg-accent" : "bg-surface-3"} disabled:opacity-50`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${state === "on" ? "left-6" : "left-1"}`} />
          </button>
        )}
      </div>
      {state === "on" && (
        <button type="button" onClick={test} disabled={busy} data-testid="notif-test" className={`${btn} mt-4 border border-line-strong text-ink-soft hover:text-ink`}>Send a test</button>
      )}
      {note && <p role="status" className="mt-3 text-sm text-muted">{note}</p>}
    </div>
  );
}
