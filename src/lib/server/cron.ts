import { createHash, timingSafeEqual } from "crypto";

/**
 * Vercel Cron calls the route with "Authorization: Bearer <CRON_SECRET>". Without CRON_SECRET set
 * the route is closed (never open by default). Comparison is constant-time.
 */
export function cronAuth(req: Request, env: Record<string, string | undefined> = process.env): "ok" | "unconfigured" | "unauthorized" {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < 16) return "unconfigured";
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return given && timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
