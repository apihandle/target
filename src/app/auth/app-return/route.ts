import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Landing page for the /auth/app-return Android App Link. When the TARGET app is installed and
 * the link is verified, Android opens MainActivity with this URL and this page is never
 * rendered — the app turns the URL into /auth/app-handoff inside its WebView. This page is only
 * the fallback for a plain browser (app not installed, or the link could not be verified). It
 * must NOT consume the one-time code. When a code is present it offers an "Open the TARGET
 * app" button: an intent:// URL that hands this same app-return link to the installed app,
 * which then claims the parked session in its WebView. Without it, a device whose App Link
 * verification failed (e.g. a signing-key mismatch) dead-ended here — sign-in had completed in
 * Chrome but the session could never reach the app.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Handoff codes are base64url (randomToken in lib/connectors/crypto). Anything else is not
  // embedded — the value lands in an href, so keep the accepted shape tight.
  const raw = url.searchParams.get("code") ?? "";
  const code = /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : null;
  const fallback = encodeURIComponent(`${url.origin}/app`);
  const openApp = code
    ? `intent://${url.host}/auth/app-return?code=${encodeURIComponent(code)}#Intent;scheme=https;package=app.target.assistant;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end`
    : null;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signed in — TARGET</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0b10; color: #f4f4f5; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  main { max-width: 420px; text-align: center; }
  a { color: #a5b4fc; }
  a.btn { display: inline-block; margin-top: 12px; padding: 12px 20px; border-radius: 999px; background: #f4f4f5; color: #0b0b10; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>You&rsquo;re signed in</h1>
  <p>This link is meant to open in the TARGET app to finish signing you in there.</p>
  ${openApp ? `<p><a class="btn" href="${openApp}">Open the TARGET app</a></p>
  <p>If the app didn&rsquo;t open, install or update TARGET, then tap the button again — this link works only once and only for a short time.</p>` : `<p>Go back to the TARGET app and you should be signed in there.</p>`}
  <p><a href="/app">Continue on the web instead</a></p>
</main>
</body>
</html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
