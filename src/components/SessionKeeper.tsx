"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { loginUrl, withSessionRetry } from "@/lib/authFetch";

declare global { interface Window { __targetFetchPatched?: boolean } }

/**
 * Keeps the user signed in until they sign out themselves:
 * - the Supabase browser client refreshes the session in the background before it expires,
 * - when the tab or installed app comes back (phone unlocked, app reopened) the session is checked and renewed,
 * - an /api call that gets 401 refreshes silently and retries once instead of bouncing to the login page,
 * - signing out in one tab signs out every open tab.
 */
export default function SessionKeeper() {
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try { supabase = createClient(); } catch { return; }

    const expired = () => { window.location.href = loginUrl(window.location.pathname, window.location.search); };
    if (!window.__targetFetchPatched) {
      window.__targetFetchPatched = true;
      const base = window.fetch.bind(window);
      window.fetch = withSessionRetry(base, async () => {
        const { data, error } = await supabase.auth.refreshSession();
        return !error && !!data.session;
      }, window.location.origin, expired);
    }

    const wake = () => { if (document.visibilityState === "visible") supabase.auth.getSession().catch(() => undefined); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full-page navigation on sign-out so all client state is dropped
      if (event === "SIGNED_OUT") window.location.href = "/login";
    });
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      sub.subscription.unsubscribe();
    };
  }, []);
  return null;
}
