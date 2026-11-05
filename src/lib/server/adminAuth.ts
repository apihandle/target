import { notFound as pageNotFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { isAdminUser } from "@/lib/server/adminCheck";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { json, type Db } from "@/lib/server/auth";

export { isAdminEmailListed, isAdminUser } from "@/lib/server/adminCheck";

/**
 * Admin access for /admin and /api/admin: a signed-in user whose email is in ADMIN_EMAILS (comma separated).
 * Everyone else (signed out, signed in but not listed, ADMIN_EMAILS unset) gets a plain 404 so the panel's
 * existence isn't revealed. The service-role client is created only after this check passes.
 */
export type AdminCtx = { user: User; db: Db };

export const adminNotFound = () => json({ error: "Not found" }, 404);

/** For /api/admin routes: null means answer adminNotFound(). */
export async function requireAdmin(): Promise<AdminCtx | null> {
  let user: User | null = null;
  try {
    const sb = await createClient();
    user = (await sb.auth.getUser()).data.user;
  } catch { return null; }
  if (!isAdminUser(user)) return null;
  let db: Db;
  try { db = createAdminClient() as unknown as Db; } catch { return null; }
  return { user: user!, db };
}

/** For /admin pages: renders the 404 page for anyone who isn't an admin. */
export async function requireAdminPage(): Promise<AdminCtx> {
  const a = await requireAdmin();
  if (!a) pageNotFound();
  return a;
}
