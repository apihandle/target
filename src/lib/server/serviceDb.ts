import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/server/auth";

/**
 * The service-role client for tables whose writes are server-only by grant (the per-user social
 * tables of migrations 0023–0025 give `authenticated` SELECT/DELETE only, and key_box is never
 * readable by browser roles). User-level routes use this for their own rows — every query in the
 * social modules is scoped by the caller's user id — exactly like /api/admin routes use
 * requireAdmin's db. Falls back to the session client when the service role isn't configured
 * (local dev), where the same code paths run against the dev database.
 */
export function serviceDb(fallback: Db): Db {
  try {
    return createAdminClient() as unknown as Db;
  } catch {
    return fallback;
  }
}
