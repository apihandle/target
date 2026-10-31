"use client";
import { useEffect } from "react";
import { sendErrorReport } from "@/lib/clientErrors";

/** Sends uncaught browser errors to /api/errors so the site owner hears about them. Renders nothing. */
export default function ErrorReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const onError = (e: ErrorEvent) => {
      // Errors from other origins (ads, extensions) arrive as a bare "Script error." with no details: skip them.
      if (!e.error && /^Script error\.?$/.test(e.message)) return;
      sendErrorReport(e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => sendErrorReport(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
