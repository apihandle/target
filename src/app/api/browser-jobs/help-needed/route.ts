import { json, requireUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Tiny check the app shell polls: is a browser task waiting for the owner (a captcha to tap through)? */
export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("browser_jobs").select("id, goal, reason:help->>reason").eq("user_id", a.user.id).eq("status", "running").not("help", "is", null).limit(3);
  if (error) return json({ jobs: [] }); // before migration 0016
  return json({ jobs: data ?? [] });
}
