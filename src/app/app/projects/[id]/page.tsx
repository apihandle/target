import { notFound } from "next/navigation";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import ProjectDetail from "@/components/ProjectDetail";
import { PROJECT_COLS, type Project } from "@/lib/projects";
import { TASK_COLS, type Task } from "@/lib/tasks";
import { ACTIVITY_COLS, type ActivityEvent } from "@/lib/activity";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project · TARGET" };

export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { supabase, user } = await getSessionOrRedirect(`/app/projects/${params.id}`);
  if (!isUuid(params.id)) notFound();
  const { data: project } = await supabase.from("projects").select(PROJECT_COLS).eq("id", params.id).eq("user_id", user.id).maybeSingle();
  if (!project) notFound();
  const [{ data: chats }, { data: tasks }, { data: events }] = await Promise.all([
    supabase.from("conversations").select("id, title, updated_at").eq("user_id", user.id).eq("project_id", params.id).order("updated_at", { ascending: false }).limit(50),
    supabase.from("tasks").select(TASK_COLS).eq("user_id", user.id).eq("project_id", params.id).order("updated_at", { ascending: false }).limit(100),
    supabase.from("activity_events").select(ACTIVITY_COLS).eq("user_id", user.id).eq("project_id", params.id).order("created_at", { ascending: false }).limit(15),
  ]);
  return (
    <AppShell user={user} section="projects">
      <ProjectDetail project={project as Project} chats={chats ?? []} tasks={(tasks ?? []) as Task[]} events={(events ?? []) as ActivityEvent[]} />
    </AppShell>
  );
}
