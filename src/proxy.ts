import { type NextFetchEvent, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  return updateSession(request, event);
}

export const config = {
  // /api is included so a signed-in user's session is refreshed on every API call too (no surprise
  // logouts during a long chat). Machine endpoints with their own auth are left out. /admin is matched so
  // non-admins get a 404 before any page code runs (pages and routes check again on the server).
  matcher: ["/app/:path*", "/admin", "/admin/:path*", "/login", "/api/((?!cron|site-sessions/worker|browser-jobs/worker|compute/worker).*)"],
};
