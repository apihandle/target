import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Chat, { type UIMsg } from "@/components/Chat";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";
export const metadata = { title: "TARGET" };

export default async function AppHome({ searchParams }: { searchParams: { c?: string; p?: string; q?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");

  const { data: convs } = await supabase.from("conversations").select("id, title").order("updated_at", { ascending: false }).limit(50);
  const activeId = searchParams.c;
  let initial: UIMsg[] = [];
  let projectId: string | undefined;
  let projectName: string | undefined;
  if (activeId) {
    const { data: conv } = await supabase.from("conversations").select("project_id, projects(name)").eq("id", activeId).maybeSingle();
    if (conv?.project_id) {
      projectId = conv.project_id as string;
      const pj = conv.projects as unknown as { name: string } | { name: string }[] | null;
      projectName = Array.isArray(pj) ? pj[0]?.name : pj?.name;
    }
    const { data: msgs } = await supabase.from("messages").select("role, content").eq("conversation_id", activeId).order("created_at");
    initial = (msgs ?? []).filter((m) => m.role !== "system") as UIMsg[];
  } else if (searchParams.p) {
    const { data: proj } = await supabase.from("projects").select("id, name").eq("id", searchParams.p).maybeSingle();
    if (proj) { projectId = proj.id as string; projectName = proj.name as string; }
  }

  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={convs ?? []} activeId={activeId} email={user.email ?? ""} />
      <main className="flex-1 overflow-hidden">
        <Chat key={activeId ?? `new-${projectId ?? ""}`} conversationId={activeId} initialMessages={initial} projectId={projectId} projectName={projectName} initialPrompt={!activeId ? searchParams.q?.slice(0, 4000) : undefined} />
      </main>
    </div>
  );
}
