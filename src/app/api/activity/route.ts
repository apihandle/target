import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { ACTIVITY_COLS, ACTIVITY_FILTERS, parseFilter } from "@/lib/activity";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const url = new URL(req.url);
  const cats = ACTIVITY_FILTERS[parseFilter(url.searchParams.get("filter"))];
  let q = a.db.from("activity_events").select(ACTIVITY_COLS).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(100);
  if (cats) q = q.in("category", cats as unknown as string[]);
  const project = url.searchParams.get("project");
  if (project) { if (!isUuid(project)) return badRequest("Unknown project"); q = q.eq("project_id", project); }
  const { data, error } = await q;
  if (error) return dbError(error, "Could not load activity");
  return json({ events: data });
}

/** Clear activity history. Requires { confirm: true } so it can't happen by accident. */
export async function DELETE(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (body?.confirm !== true) return badRequest("Confirmation required");
  const { error } = await a.db.from("activity_events").delete().eq("user_id", a.user.id);
  if (error) return dbError(error, "Could not clear activity");
  return json({ ok: true });
}
