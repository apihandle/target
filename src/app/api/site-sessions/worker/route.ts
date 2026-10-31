import { badRequest, json, readJson } from "@/lib/server/auth";
import { UUID_RE, workerAuth } from "@/lib/server/worker";
import { invalidateSiteSession, loadSiteCookies, saveSiteSession } from "@/lib/server/siteSessions";
import { checkLimit } from "@/lib/connectors/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Trusted session worker only (Bearer SESSION_WORKER_SECRET). Never called from the browser.
 * POST saves cookies after a sign-in/registration; GET returns them to resume that session.
 */
function guard(req: Request) {
  const auth = workerAuth(req);
  if (auth === "unconfigured") return json({ error: "Session worker is not configured" }, 503);
  if (auth !== "ok") return json({ error: "Unauthorized" }, 401);
  return null;
}

export async function POST(req: Request) {
  const g = guard(req); if (g) return g;
  const b = await readJson(req);
  if (!b || typeof b.user_id !== "string" || !UUID_RE.test(b.user_id)) return badRequest("user_id required");
  if (!(await checkLimit({ key: `session-save:${b.user_id}`, limit: 30, windowSec: 60 }))) return json({ error: "Too many requests" }, 429);
  if (b.action === "invalidate") {
    const n = await invalidateSiteSession(b.user_id, String(b.site ?? ""), typeof b.account_email === "string" ? b.account_email : undefined);
    return json({ ok: true, expired: n });
  }
  const r = await saveSiteSession({ userId: b.user_id, site: String(b.site ?? ""), accountEmail: typeof b.account_email === "string" ? b.account_email : "", via: String(b.via ?? ""), cookies: b.cookies });
  if (!r.ok) return badRequest(r.error);
  return json({ ok: true, id: r.id, domain: r.domain, cookies: r.cookieCount });
}

export async function GET(req: Request) {
  const g = guard(req); if (g) return g;
  const u = new URL(req.url);
  const userId = u.searchParams.get("user_id") ?? "";
  if (!UUID_RE.test(userId)) return badRequest("user_id required");
  if (!(await checkLimit({ key: `session-load:${userId}`, limit: 60, windowSec: 60 }))) return json({ error: "Too many requests" }, 429);
  const email = u.searchParams.get("account_email") ?? undefined;
  const cookies = await loadSiteCookies(userId, u.searchParams.get("site") ?? "", email);
  if (!cookies) return json({ found: false }, 404);
  return new Response(JSON.stringify({ found: true, cookies }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
