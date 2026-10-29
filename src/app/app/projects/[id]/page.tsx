import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import ProjectDetail from "@/components/ProjectDetail";
import type { Project } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project · TARGET" };

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/app/projects/${params.id}`);
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { data: project } = await supabase.from("projects").select("id, name, instructions, created_at, updated_at").eq("id", params.id).maybeSingle();
  if (!project) notFound();
  const [{ data: convs }, { data: chats }] = await Promise.all([
    supabase.from("conversations").select("id, title").order("updated_at", { ascending: false }).limit(50),
    supabase.from("conversations").select("id, title").eq("project_id", params.id).order("updated_at", { ascending: false }),
  ]);
  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={convs ?? []} email={user.email ?? ""} section="projects" />
      <main className="flex-1 overflow-y-auto"><ProjectDetail project={project as Project} chats={chats ?? []} /></main>
    </div>
  );
}
