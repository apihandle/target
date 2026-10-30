import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY: used exclusively for the connection_secrets table
 * (no RLS policies, invisible to browsers) and for writing connection rows after OAuth.
 * Never import this from a client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
