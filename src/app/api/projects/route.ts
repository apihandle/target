import { createClient } from "@/lib/supabase/server";
import { validateProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase.from("projects").select("id, name, instructions, created_at, updated_at").order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ projects: data });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const v = validateProject(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const { count } = await supabase.from("projects").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 50) return Response.json({ error: "Project limit reached" }, { status: 400 });
  const { data, error } = await supabase.from("projects").insert({ user_id: user.id, name: v.value.name, instructions: v.value.instructions ?? "" })
    .select("id, name, instructions, created_at, updated_at").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ project: data }, { status: 201 });
}
