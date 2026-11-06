import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Landing page for the /auth/app-return Android App Link. When the TARGET app is installed and
 * the link is verified, Android opens MainActivity with this URL and this page is never
 * rendered — the app turns the URL into /auth/app-handoff inside its WebView. This page is only
 * the fallback for a plain browser (app not installed, or the link could not be verified). It
 * must NOT consume the one-time code, so it simply points the user back to the app / sign-in.
 */
export async function GET() {
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
</style>
</head>
<body>
<main>
  <h1>You&rsquo;re signed in</h1>
  <p>This link is meant to open in the TARGET app. If the app didn&rsquo;t open, go back to the app and you should be signed in there.</p>
  <p><a href="/app">Continue on the web instead</a></p>
</main>
</body>
</html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
