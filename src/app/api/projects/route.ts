import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { PROJECT_COLS, validateProject } from "@/lib/projects";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  let q = a.db.from("projects").select(PROJECT_COLS).eq("user_id", a.user.id).order("updated_at", { ascending: false });
  q = archived ? q.eq("status", "archived") : q.neq("status", "archived");
  const { data, error } = await q;
  if (error) return dbError(error, "Could not load projects");
  return json({ projects: data });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateProject(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const { count } = await a.db.from("projects").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= 50) return badRequest("Project limit reached");
  const { data, error } = await a.db.from("projects")
    .insert({ user_id: a.user.id, name: v.value.name, instructions: v.value.instructions ?? "", description: v.value.description ?? "" })
    .select(PROJECT_COLS).single();
  if (error || !data) return dbError(error, "Could not create project");
  await logActivity(a.db, a.user.id, { category: "project", title: `Project created: “${v.value.name}”`, project_id: data.id as string });
  return json({ project: data }, 201);
}
