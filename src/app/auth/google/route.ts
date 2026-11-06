import { NextResponse } from "next/server";
import { safeNext } from "@/lib/ids";
import { LOGIN_COOKIE, encodeLoginCookie, loginAuthorizeUrl, newLogin } from "@/lib/auth/googleLogin";

export const dynamic = "force-dynamic";

/** Start "Continue with Google" on TARGET's own domain. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return NextResponse.redirect(`${origin}/login?error=google`, { status: 303 });
  }
  const { cookie, hashedNonce } = newLogin(safeNext(url.searchParams.get("next")), url.searchParams.get("app") === "1");
  const res = NextResponse.redirect(loginAuthorizeUrl(process.env, origin, cookie.state, hashedNonce), { status: 303 });
  res.cookies.set(LOGIN_COOKIE, encodeLoginCookie(cookie), { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

