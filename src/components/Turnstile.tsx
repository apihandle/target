"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

export type TurnstileHandle = { reset: () => void };
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
  if (!s) { s = document.createElement("script"); s.src = SRC; s.async = true; s.defer = true; document.head.appendChild(s); }
  return new Promise((res, rej) => { s!.addEventListener("load", () => res()); s!.addEventListener("error", () => rej(new Error("captcha script"))); });
}

/** Cloudflare Turnstile (free bot check). Renders nothing when no site key is configured. */
const Turnstile = forwardRef<TurnstileHandle, { siteKey?: string; onToken: (t: string | null) => void }>(function Turnstile({ siteKey, onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useImperativeHandle(ref, () => ({ reset: () => { cb.current(null); if (id.current && window.turnstile) window.turnstile.reset(id.current); } }), []);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: siteKey, theme: "dark", appearance: "interaction-only",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(null),
        "error-callback": () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => { gone = true; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = null; };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={box} data-testid="turnstile" className="flex justify-center" />;
});

export default Turnstile;
