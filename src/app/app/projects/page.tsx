import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import ProjectList from "@/components/ProjectList";
import { PROJECT_COLS, type Project } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects · TARGET" };

export default async function ProjectsPage({ searchParams }: { searchParams: { new?: string; view?: string } }) {
  const { supabase, user } = await getSessionOrRedirect("/app/projects");
  const archived = searchParams.view === "archived";
  let pq = supabase.from("projects").select(PROJECT_COLS).eq("user_id", user.id).order("updated_at", { ascending: false });
  pq = archived ? pq.eq("status", "archived") : pq.neq("status", "archived");
  const [{ data: convs }, { data: projects, error }, { data: tasks }] = await Promise.all([
    supabase.from("conversations").select("project_id").eq("user_id", user.id).not("project_id", "is", null).limit(1000),
    pq,
    supabase.from("tasks").select("project_id, status").eq("user_id", user.id).not("project_id", "is", null).limit(2000),
  ]);
  const chats = new Map<string, number>(), open = new Map<string, number>();
  for (const c of convs ?? []) chats.set(c.project_id as string, (chats.get(c.project_id as string) ?? 0) + 1);
  for (const t of tasks ?? []) if (t.status !== "completed" && t.status !== "cancelled") open.set(t.project_id as string, (open.get(t.project_id as string) ?? 0) + 1);
  const list = ((projects ?? []) as Project[]).map((p) => ({ ...p, chats: chats.get(p.id) ?? 0, openTasks: open.get(p.id) ?? 0 }));
  return (
    <AppShell user={user} section="projects">
      <ProjectList initial={list} startOpen={searchParams.new === "1"} archivedView={archived} loadError={!!error} />
    </AppShell>
  );
}
