import type { User } from "@supabase/supabase-js";
import { parseAdminEmails } from "@/lib/adminConfig";

/** Admin check without Next.js server imports, so the proxy can use it too. */
export function isAdminEmailListed(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  return parseAdminEmails(env.ADMIN_EMAILS).includes(email.trim().toLowerCase());
}

/** Supabase marks unconfirmed emails; an admin must have a confirmed address. */
function confirmed(u: User): boolean {
  return !!(u.email_confirmed_at || (u as { confirmed_at?: string }).confirmed_at || u.app_metadata?.provider === "google");
}

export function isAdminUser(u: User | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return !!u && confirmed(u) && isAdminEmailListed(u.email, env);
}
