import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { TASK_COLS, TASK_STATUSES, validateNewTask, type TaskStatus } from "@/lib/tasks";
import { isUuid } from "@/lib/ids";
import { logActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const url = new URL(req.url);
  let q = a.db.from("tasks").select(TASK_COLS).eq("user_id", a.user.id).order("updated_at", { ascending: false }).limit(200);
  const project = url.searchParams.get("project");
  if (project) { if (!isUuid(project)) return badRequest("Unknown project"); q = q.eq("project_id", project); }
  const status = url.searchParams.get("status");
  if (status) { if (!TASK_STATUSES.includes(status as TaskStatus)) return badRequest("Unknown status"); q = q.eq("status", status); }
  const { data, error } = await q;
  if (error) return dbError(error, "Could not load tasks");
  return json({ tasks: data });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateNewTask(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  if (v.value.project_id) {
    const { data: p } = await a.db.from("projects").select("id").eq("id", v.value.project_id).eq("user_id", a.user.id).maybeSingle();
    if (!p) return json({ error: "Project not found", field: "project_id" }, 404);
  }
  const { count } = await a.db.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= 1000) return badRequest("Task limit reached");
  const { data, error } = await a.db.from("tasks").insert({ user_id: a.user.id, ...v.value, status: "queued", origin: "user" }).select(TASK_COLS).single();
  if (error || !data) return dbError(error, "Could not create task");
  await logActivity(a.db, a.user.id, { category: "task", title: `Task added: “${v.value.title}”`, status: "queued", task_id: data.id as string, project_id: v.value.project_id });
  return json({ task: data }, 201);
}
