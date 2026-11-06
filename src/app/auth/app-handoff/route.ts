import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeAppHandoff } from "@/lib/auth/appHandoff";

export const dynamic = "force-dynamic";

/**
 * Runs inside the Android app's WebView (the app turns the /auth/app-return App Link into this
 * URL). Swaps the one-time handoff code for the Supabase session that the Google callback
 * created in Chrome, so the session cookies are set in the WebView, then continues to the
 * page the user was headed for.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fail = () => NextResponse.redirect(`${origin}/login?error=google`, { status: 303 });
  const handoff = await consumeAppHandoff(url.searchParams.get("code") ?? "").catch(() => null);
  if (!handoff) return fail();
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession(handoff.session);
  if (error) {
    console.error("[auth] app handoff setSession failed:", error.message.slice(0, 160));
    return fail();
  }
  return NextResponse.redirect(`${origin}${handoff.next}`, { status: 303 });
}
