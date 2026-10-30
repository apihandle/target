import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type Db = SupabaseClient;
export type Authed = { db: Db; user: User };

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const unauthorized = () => json({ error: "Not signed in" }, 401);
export const notFound = () => json({ error: "Not found" }, 404);
export const badRequest = (error: string) => json({ error }, 400);

/** Resolve the signed-in user from the session cookie. Every API route calls this first. */
export async function requireUser(): Promise<Authed | null> {
  const db = createClient() as unknown as Db;
  const { data: { user } } = await db.auth.getUser();
  return user ? { db, user } : null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const j = await req.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Database errors are logged server-side and reported generically so table details don't leak. */
export function dbError(e: { message?: string } | null | undefined, what = "Request failed") {
  if (e?.message) console.error(`[db] ${what}: ${e.message}`);
  return json({ error: what }, 500);
}
