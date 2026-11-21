import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // Deliberately pass @supabase/ssr's options through unchanged — in particular the
            // auth cookies stay httpOnly: false (the library default). The browser client
            // shares this same cookie store: useSignedIn, SessionKeeper (background refresh,
            // the 401-retry fetch patch) and Chat read/refresh the session from JS, so marking
            // the cookies HttpOnly would sign the web UI out from under the server session.
            // XSS exposure is mitigated by the strict CSP in next.config.mjs instead.
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a Server Component; middleware refreshes the session
          }
        },
      },
    }
  );
}
