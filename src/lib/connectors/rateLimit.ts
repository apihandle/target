/**
 * Fixed-window rate limiting for connect and tool-call routes.
 *
 * With SUPABASE_SERVICE_ROLE_KEY set, counts live in Postgres (`connector_rate_hit()` from
 * migration 0007), so the limit holds across every serverless instance. Without it (local dev,
 * tests) it falls back to an in-memory counter, which on Vercel is per-instance only: a user hitting
 * several warm instances could exceed the limit by that factor. If the DB call itself errors, the check
 * falls back to the in-memory counter (logged) rather than locking users out.
 */
export type Limit = { key: string; limit: number; windowSec: number };

export const LIMITS = {
  connect: (uid: string): Limit => ({ key: `connect:${uid}`, limit: 10, windowSec: 600 }),
  toolCall: (uid: string): Limit => ({ key: `tool:${uid}`, limit: 30, windowSec: 60 }),
  chat: (uid: string): Limit => ({ key: `chat:${uid}`, limit: 20, windowSec: 60 }),
};

const mem = new Map<string, { window: number; hits: number }>();

export function hitMemory(l: Limit, now = Date.now()): boolean {
  const window = Math.floor(now / (l.windowSec * 1000));
  const cur = mem.get(l.key);
  if (!cur || cur.window !== window) { mem.set(l.key, { window, hits: 1 }); return true; }
  cur.hits += 1;
  return cur.hits <= l.limit;
}

export function resetMemoryLimits() { mem.clear(); }

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };

/** Returns true when the request is allowed. */
export async function rateLimit(l: Limit, client?: RpcClient | null): Promise<boolean> {
  if (client) {
    try {
      const { data, error } = await client.rpc("connector_rate_hit", { p_key: l.key, p_window_seconds: l.windowSec, p_limit: l.limit });
      if (!error && typeof data === "boolean") return data;
      if (error) console.error("[rate-limit] db check failed:", error.message ?? "unknown");
    } catch { console.error("[rate-limit] db check threw"); }
  }
  return hitMemory(l);
}

/** Uses the DB limiter when the service role is configured, else memory. */
export async function checkLimit(l: Limit): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return hitMemory(l);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return rateLimit(l, createAdminClient() as unknown as RpcClient);
}

export const tooMany = () => Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
