import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { CONNECTOR_ID, getConnector, isConfigured } from "@/lib/connectors/registry";
import { exchangeCode } from "@/lib/connectors/oauth";
import { consumeState } from "@/lib/connectors/state";
import { saveConnection } from "@/lib/connectors/store";
import { resumeTasksFor } from "@/lib/connectors/resume";
import { redact } from "@/lib/connectors/safety";
import { logActivity } from "@/lib/server/activity";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_COOKIE, LOGIN_PREFIX, exchangeLoginCode, parseLoginCookie } from "@/lib/auth/googleLogin";
import { createAppHandoff } from "@/lib/auth/appHandoff";
import { connectionFromLogin } from "@/lib/connectors/googleFromLogin";

export const dynamic = "force-dynamic";

/** OAuth callback: verify state (single-use, this user + connector), exchange the code, encrypt, save. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const url = new URL(req.url);
  const origin = url.origin;
  const page = (q: string) => NextResponse.redirect(`${origin}/app/connectors?${q}`, { status: 303 });
  if (params.id === "google" && (url.searchParams.get("state") ?? "").startsWith(LOGIN_PREFIX)) return googleLogin(url);
  const a = await requireUser();
  if (!a) return NextResponse.redirect(`${origin}/login?next=/app/connectors`, { status: 303 });
  const c = CONNECTOR_ID.test(params.id) ? getConnector(params.id) : undefined;
  if (!c || !c.oauth || !isConfigured(c, process.env)) return page("error=setup");

  // Consume the state first, even when the provider reports an error, so it can't be replayed.
  const st = await consumeState(url.searchParams.get("state") ?? "", a.user.id, c.id).catch(() => null);
  if (url.searchParams.get("error")) return page(`error=denied&connector=${c.id}`);
  if (!st) return page(`error=state&connector=${c.id}`);
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return page(`error=denied&connector=${c.id}`);

  try {
    const t = await exchangeCode(c, process.env, { code, redirectUri: `${origin}/api/connectors/${c.id}/callback`, codeVerifier: st.codeVerifier });
    const meta = c.oauth.callbackMeta?.(url.searchParams);
    await saveConnection(a.user.id, c.id, { creds: t.creds, accountLabel: t.accountLabel, scopes: t.scopes, meta });
  } catch (e) {
    console.error(`[connectors] ${c.id} connect failed:`, redact(e instanceof Error ? e.message : String(e)).slice(0, 200));
    return page(`error=exchange&connector=${c.id}`);
  }
  await logActivity(a.db, a.user.id, { category: "connection", title: `Connected ${c.name}` });
  await resumeTasksFor(a.db, a.user.id, c);
  if (st.returnTo) return NextResponse.redirect(`${origin}${st.returnTo}`, { status: 303 });
  return page(`connected=${c.id}`);
}

/** "Continue with Google" sign-in that came back to TARGET's own domain. */
async function googleLogin(url: URL) {
  const origin = url.origin;
  const fail = () => {
    const r = NextResponse.redirect(`${origin}/login?error=google`, { status: 303 });
    r.cookies.delete(LOGIN_COOKIE);
    return r;
  };
  const saved = parseLoginCookie((await cookies()).get(LOGIN_COOKIE)?.value);
  const state = (url.searchParams.get("state") ?? "").slice(LOGIN_PREFIX.length);
  if (!saved || !state || saved.state !== state) return fail();
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code || code.length > 2000) return fail();
  try {
    const t = await exchangeLoginCode(process.env, origin, code);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: t.id_token, nonce: saved.nonce });
    if (error || !data.user) {
      console.error("[auth] google id-token sign-in failed:", (error?.message ?? "no user").slice(0, 160));
      return fail();
    }
    try {
      const conn = await connectionFromLogin({ provider_token: t.access_token, provider_refresh_token: t.refresh_token });
      if (conn) await saveConnection(data.user.id, "google", conn);
    } catch (e) {
      console.error("[auth] google auto-connect failed:", e instanceof Error ? e.message.slice(0, 120) : "error");
    }
    if (saved.app) {
      // Started from the Android app: this callback is running in Chrome, so a session set here
      // would never reach the app's WebView. Park the session behind a one-time handoff code and
      // send Chrome to the App Link return URL; the app swaps the code for the session in its WebView.
      if (!data.session) return fail();
      try {
        // Fix #4: carry the login cookie's PKCE challenge onto the handoff row (null for older
        // app builds that never sent one — those rows keep the legacy code-only claim).
        const handoff = await createAppHandoff({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, saved.next, undefined, undefined, saved.challenge ?? null);
        const r = NextResponse.redirect(`${origin}/auth/app-return?code=${encodeURIComponent(handoff)}`, { status: 303 });
        r.cookies.delete(LOGIN_COOKIE);
        return r;
      } catch (e) {
        console.error("[auth] app handoff failed:", e instanceof Error ? e.message.slice(0, 120) : "error");
        return fail();
      }
    }
    const r = NextResponse.redirect(`${origin}${saved.next}`, { status: 303 });
    r.cookies.delete(LOGIN_COOKIE);
    return r;
  } catch (e) {
    console.error("[auth] google login failed:", redact(e instanceof Error ? e.message : String(e)).slice(0, 160));
    return fail();
  }
}

