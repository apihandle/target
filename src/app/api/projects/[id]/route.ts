import { createClient } from "@/lib/supabase/server";
import { validateProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Bad JSON" }, { status: 400 });
  const v = validateProject(body, true);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const { data, error } = await supabase.from("projects").update({ ...v.value, updated_at: new Date().toISOString() })
    .eq("id", params.id).select("id, name, instructions, created_at, updated_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase.from("projects").delete().eq("id", params.id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
