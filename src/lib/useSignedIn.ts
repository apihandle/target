"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** True once the browser has a Supabase session (read locally, no network). */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      const sb = createClient();
      sb.auth.getSession().then(({ data }) => { if (alive) setSignedIn(!!data.session); }).catch(() => {});
      const { data } = sb.auth.onAuthStateChange((_e, s) => { if (alive) setSignedIn(!!s); });
      return () => { alive = false; data.subscription.unsubscribe(); };
    } catch {
      return () => { alive = false; };
    }
  }, []);
  return signedIn;
}
