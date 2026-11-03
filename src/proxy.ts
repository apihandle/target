import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // /api is included so a signed-in user's session is refreshed on every API call too (no surprise
  // logouts during a long chat). Machine endpoints with their own auth are left out.
  matcher: ["/app/:path*", "/login", "/api/((?!cron|site-sessions/worker|browser-jobs/worker|compute/worker).*)"],
};
