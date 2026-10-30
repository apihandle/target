import { badRequest, dbError, json, readJson, requireUser, unauthorized } from "@/lib/server/auth";
import { BUILTIN_TEMPLATES, MAX_USER_TEMPLATES, TEMPLATE_COLS, validateTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a) return unauthorized();
  const { data, error } = await a.db.from("prompt_templates").select(TEMPLATE_COLS).eq("user_id", a.user.id).order("created_at", { ascending: false }).limit(MAX_USER_TEMPLATES);
  // Built-ins still work before migration 0008 is applied.
  if (error) console.error("[db] Could not load templates:", error.message);
  return json({ builtin: BUILTIN_TEMPLATES, templates: error ? [] : data ?? [] });
}

export async function POST(req: Request) {
  const a = await requireUser();
  if (!a) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest("Bad JSON");
  const v = validateTemplate(body);
  if (!v.ok) return json({ error: v.error, field: v.field }, 400);
  const { count } = await a.db.from("prompt_templates").select("id", { count: "exact", head: true }).eq("user_id", a.user.id);
  if ((count ?? 0) >= MAX_USER_TEMPLATES) return badRequest(`You can save up to ${MAX_USER_TEMPLATES} templates. Delete one first.`);
  const { data, error } = await a.db.from("prompt_templates").insert({ user_id: a.user.id, ...v.value }).select(TEMPLATE_COLS).single();
  if (error || !data) return dbError(error, "Could not save the template");
  return json({ template: data }, 201);
}
