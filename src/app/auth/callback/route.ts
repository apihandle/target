import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/ids";
import { connectionFromLogin } from "@/lib/connectors/googleFromLogin";
import { saveConnection } from "@/lib/connectors/store";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A Google sign-in also connects Google (Gmail, Calendar, Drive) with the scopes the user granted.
      const s = data?.session;
      if (s?.user && s.provider_token && s.user.app_metadata?.provider === "google") {
        try {
          const conn = await connectionFromLogin(s);
          if (conn) await saveConnection(s.user.id, "google", conn);
        } catch (e) {
          console.error("[auth] google auto-connect failed:", e instanceof Error ? e.message.slice(0, 120) : "error");
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
