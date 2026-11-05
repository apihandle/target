import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isAdminUser } from "@/lib/server/adminCheck";
import { getAdminSettings } from "@/lib/server/adminSettings";
import { touchPresence } from "@/lib/server/presence";

/** /admin and /api/admin: anyone who isn't an admin gets the plain 404 page / JSON, never a login redirect. */
export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/") || path === "/api/admin" || path.startsWith("/api/admin/");

/** API routes that keep working during maintenance (admin tools, client error reports, auth). */
const MAINTENANCE_OPEN_API = ["/api/admin", "/api/errors", "/api/auth"];

/**
 * Admin writes must come from TARGET's own pages: a POST/PUT/PATCH/DELETE to /api/admin whose Origin (or, without
 * one, Sec-Fetch-Site) says another site is refused, on top of the session cookie's SameSite=Lax.
 */
export function sameOriginWrite(request: Pick<NextRequest, "method" | "headers" | "nextUrl">): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host); } catch { return false; }
  }
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

function notFoundResponse(request: NextRequest, path: string) {
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Rewrite to a path that has no page, so Next renders its normal not-found page with a 404 status.
  const to = request.nextUrl.clone();
  to.pathname = "/_not-found-admin";
  to.search = "";
  return NextResponse.rewrite(to, { status: 404 });
}

export async function updateSession(request: NextRequest, event?: Pick<NextFetchEvent, "waitUntil">) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  if (!url || !key) return isAdminPath(path) ? notFoundResponse(request, path) : response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() also refreshes an expired access token with the refresh token and writes the new cookies.
  const { data: { user } } = await supabase.auth.getUser();
  const admin = isAdminUser(user);
  // Presence for the admin dashboard (country code + coarse device, at most every 5 min per user; never the IP).
  if (user) {
    const p = touchPresence(user.id, request.headers).catch(() => false);
    if (event) event.waitUntil(p);
  }
  if (isAdminPath(path)) {
    if (!admin) return notFoundResponse(request, path);
    if (!sameOriginWrite(request)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  // Maintenance mode (admin_settings, cached briefly): /app and its APIs pause for everyone except admins.
  const inApp = path === "/app" || path.startsWith("/app/");
  const inApi = path.startsWith("/api/") && !MAINTENANCE_OPEN_API.some((p) => path === p || path.startsWith(`${p}/`));
  if (user && !admin && (inApp || inApi) && path !== "/app/maintenance") {
    const { maintenance } = await getAdminSettings();
    if (maintenance.enabled) {
      if (inApi) return NextResponse.json({ error: maintenance.message || "TARGET is down for maintenance. Please try again soon.", maintenance: true }, { status: 503 });
      const to = request.nextUrl.clone();
      to.pathname = "/app/maintenance";
      to.search = "";
      const r = NextResponse.rewrite(to, { status: 503 });
      response.cookies.getAll().forEach((c) => r.cookies.set(c));
      return r;
    }
  }

  if (path.startsWith("/api/")) return response; // APIs answer 401 themselves; never redirect them

  if (!user && path.startsWith("/app")) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    to.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(to);
  }
  if (user && path === "/login") {
    const to = request.nextUrl.clone();
    to.pathname = "/app";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}
