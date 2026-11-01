import { dbError, json, requireUser, unauthorized } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const base = "id, goal, start_url, steps, status, result, error, created_at, finished_at";
  let { data, error }: { data: Record<string, unknown>[] | null; error: unknown } = await a.db.from("browser_jobs").select(`${base}, mode, log, files, language`).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(50);
  if (error) ({ data, error } = await a.db.from("browser_jobs").select(base).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(50));
  if (error) return dbError(error, "Could not load browser tasks");
  return json({ jobs: data ?? [], worker: !!process.env.SESSION_WORKER_SECRET });
}
