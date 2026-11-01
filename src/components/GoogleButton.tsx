"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { detectInApp, openInBrowserUrl, type InApp } from "@/lib/browser";

export default function GoogleButton({ next = "/app", variant = "dark" }: { next?: string; variant?: "dark" | "glass" }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inApp, setInApp] = useState<InApp>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setInApp(detectInApp(navigator.userAgent)); }, []);

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); }
  }

  async function go() {
    // Google refuses sign-in inside app browsers, so send the user to their real browser first.
    if (inApp?.android) { window.location.href = openInBrowserUrl(window.location.href); return; }
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="google-btn"
        onClick={go}
        disabled={loading}
        className={
          variant === "glass"
            ? "flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.08] text-[14px] font-medium text-stucco transition hover:bg-white/[0.14] disabled:opacity-60"
            : "flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-60"
        }
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        {loading ? "Opening Google…" : "Continue with Google"}
      </button>
      {inApp && (
        <div data-testid="inapp-warning" className="mt-2 rounded-xl border border-accent/30 bg-black/30 px-3 py-2 text-center text-xs text-stucco/80">
          Google sign-in doesn&apos;t work inside {inApp.app}. {inApp.android ? "Tapping the button opens TARGET in your browser." : "Open this page in Safari: tap the menu, then Open in browser."}
          {!inApp.android && <button type="button" onClick={copyLink} className="ml-1 underline" data-testid="inapp-copy">{copied ? "Link copied" : "Copy link"}</button>}
        </div>
      )}
      {error && <p data-testid="google-error" className="mt-2 text-center text-xs text-rose-400">{error}</p>}
    </>
  );
}
