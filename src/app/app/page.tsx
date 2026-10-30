import Chat, { type UIMsg } from "@/components/Chat";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { providers } from "@/lib/llm";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat · TARGET" };

export default async function ChatPage({ searchParams }: { searchParams: { c?: string; p?: string; q?: string; t?: string; resume?: string } }) {
  const { supabase, user } = await getSessionOrRedirect("/app");
  const activeId = isUuid(searchParams.c) ? searchParams.c : undefined;
  let initial: UIMsg[] = [];
  let projectId: string | undefined;
  let projectName: string | undefined;
  let missing = false;
  if (activeId) {
    const { data: conv } = await supabase.from("conversations").select("id, project_id, projects(name)").eq("id", activeId).eq("user_id", user.id).maybeSingle();
    if (!conv) missing = true;
    else {
      if (conv.project_id) {
        projectId = conv.project_id as string;
        const pj = conv.projects as unknown as { name: string } | { name: string }[] | null;
        projectName = Array.isArray(pj) ? pj[0]?.name : pj?.name;
      }
      const { data: msgs } = await supabase.from("messages").select("role, content").eq("conversation_id", activeId).order("created_at");
      initial = (msgs ?? []).filter((m) => m.role !== "system") as UIMsg[];
    }
  } else if (isUuid(searchParams.p)) {
    const { data: proj } = await supabase.from("projects").select("id, name").eq("id", searchParams.p).eq("user_id", user.id).maybeSingle();
    if (proj) { projectId = proj.id as string; projectName = proj.name as string; }
  }
  let taskId: string | undefined, taskTitle: string | undefined;
  if (!activeId && isUuid(searchParams.t)) {
    const { data: t } = await supabase.from("tasks").select("id, title, project_id").eq("id", searchParams.t).eq("user_id", user.id).maybeSingle();
    if (t) { taskId = t.id as string; taskTitle = t.title as string; }
  }
  const prefill = typeof searchParams.q === "string" ? searchParams.q.slice(0, 2000) : taskTitle ? `Help me with this task: ${taskTitle}` : "";

  return (
    <AppShell user={user} section="chat" activeId={activeId}>
      {missing ? (
        <div className="mx-auto max-w-md px-4 pt-24 text-center">
          <h1 className="text-xl font-semibold">Chat not found</h1>
          <p className="mt-2 text-sm text-muted">It may have been deleted, or it belongs to another account.</p>
          <a href="/app" className="mt-4 inline-block text-sm text-accent-strong underline">Start a new chat</a>
        </div>
      ) : (
        <Chat key={activeId ?? `new-${projectId ?? ""}-${taskId ?? ""}`} conversationId={activeId} initialMessages={initial}
          projectId={projectId} projectName={projectName} aiConfigured={providers().length > 0} webAvailable={!!process.env.TAVILY_API_KEY}
          initialPrompt={prefill} taskId={taskId} taskTitle={taskTitle}
          resumeTaskId={activeId && isUuid(searchParams.resume) ? searchParams.resume : undefined} />
      )}
    </AppShell>
  );
}
