import { createHash, timingSafeEqual } from "crypto";

/**
 * Auth for the trusted session worker (the headless browser that signs in or registers on websites).
 * It sends "Authorization: Bearer <SESSION_WORKER_SECRET>". Closed unless a 32+ character secret is set.
 */
export function workerAuth(req: Request, env: Record<string, string | undefined> = process.env): "ok" | "unconfigured" | "unauthorized" {
  const secret = env.SESSION_WORKER_SECRET;
  if (!secret || secret.length < 32) return "unconfigured";
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return given && timingSafeEqual(a, b) ? "ok" : "unauthorized";
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
