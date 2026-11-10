import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeAppHandoff } from "@/lib/auth/appHandoff";

export const dynamic = "force-dynamic";

/**
 * Runs inside the Android app's WebView (the app turns the /auth/app-return App Link into this
 * URL). Swaps the one-time handoff code for the Supabase session that the Google callback
 * created in Chrome, so the session cookies are set in the WebView, then continues to the
 * page the user was headed for.
 *
 * Fix #4: handoffs created by current app builds are PKCE-bound — the caller must also present
 * the `verifier` whose SHA-256 the app sent as code_challenge when it started sign-in, so the
 * code alone no longer hands the session to any browser that opens this URL. The verifier is
 * accepted two ways:
 *   - GET ?verifier=… — the shape the WebView uses: a top-level page navigation cannot carry a
 *     body. Query strings can land in proxy/server logs, which is accepted here because both
 *     the code and the verifier are single-use and die with the 60 s handoff TTL.
 *   - POST with a JSON (or form) body { code, verifier } — the preferred shape for any
 *     non-browser caller, since bodies are not written to access logs.
 * Handoffs without a stored challenge (older app builds) need no verifier, as before.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fail = () => NextResponse.redirect(`${origin}/login?error=google`, { status: 303 });
  const handoff = await consumeAppHandoff(url.searchParams.get("code") ?? "", undefined, undefined, url.searchParams.get("verifier")).catch(() => null);
  if (!handoff) return fail();
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession(handoff.session);
  if (error) {
    console.error("[auth] app handoff setSession failed:", error.message.slice(0, 160));
    return fail();
  }
  return NextResponse.redirect(`${origin}${handoff.next}`, { status: 303 });
}

export async function POST(req: Request) {
  let code = "";
  let verifier: string | null = null;
  try {
    // A request body can only be read once — pick the parser from the content type.
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { code?: unknown; verifier?: unknown } | null;
      if (typeof body?.code === "string") code = body.code;
      if (typeof body?.verifier === "string") verifier = body.verifier;
    } else {
      const form = await req.formData();
      code = String(form.get("code") ?? "");
      const v = form.get("verifier");
      verifier = typeof v === "string" ? v : null;
    }
  } catch { /* unparseable body: fall through with an empty code */ }
  const fail = () => NextResponse.json({ ok: false, error: "invalid_handoff" }, { status: 400 });
  const handoff = await consumeAppHandoff(code, undefined, undefined, verifier).catch(() => null);
  if (!handoff) return fail();
  const supabase = await createClient();
  const { error } = await supabase.auth.setSession(handoff.session);
  if (error) {
    console.error("[auth] app handoff setSession failed:", error.message.slice(0, 160));
    return fail();
  }
  return NextResponse.json({ ok: true, next: handoff.next });
}
