import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import ProjectList from "@/components/ProjectList";
import type { Project } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects · TARGET" };

export default async function ProjectsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/projects");
  const [{ data: convs }, { data: projects }] = await Promise.all([
    supabase.from("conversations").select("id, title, project_id").order("updated_at", { ascending: false }).limit(200),
    supabase.from("projects").select("id, name, instructions, created_at, updated_at").order("updated_at", { ascending: false }),
  ]);
  const counts = new Map<string, number>();
  for (const c of convs ?? []) if (c.project_id) counts.set(c.project_id as string, (counts.get(c.project_id as string) ?? 0) + 1);
  const list = ((projects ?? []) as Project[]).map((p) => ({ ...p, chats: counts.get(p.id) ?? 0 }));
  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={(convs ?? []).slice(0, 50)} email={user.email ?? ""} section="projects" />
      <main className="flex-1 overflow-y-auto"><ProjectList initial={list} /></main>
    </div>
  );
}
