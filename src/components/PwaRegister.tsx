"use client";
import { useEffect } from "react";

/** Service worker for the installable /app workspace. Separate from public/sw.js (Monetag), which is never touched. */
export const APP_SW_URL = "/app-sw.js";
export const APP_SW_SCOPE = "/app";

export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register(APP_SW_URL, { scope: APP_SW_SCOPE }).catch(() => undefined);
  }, []);
  return null;
}
