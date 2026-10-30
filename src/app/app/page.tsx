import Chat, { type UIMsg } from "@/components/Chat";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { AUTO_MODEL, modelOptions, providers, resolveModel } from "@/lib/llm";
import { loadPreferredModel } from "@/lib/settings";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat · TARGET" };

export default async function ChatPage({ searchParams }: { searchParams: { c?: string; p?: string; q?: string; send?: string; t?: string; resume?: string } }) {
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
      const { data: msgs } = await supabase.from("messages").select("id, role, content").eq("conversation_id", activeId).order("created_at");
      // Attachment chips per message (empty if migration 0008 isn't applied yet).
      const { data: atts, error: attErr } = await supabase.from("attachments").select("name, kind, message_id").eq("conversation_id", activeId).eq("user_id", user.id).order("created_at");
      const byMsg = new Map<string, { name: string; kind: string }[]>();
      if (!attErr) for (const a of (atts ?? []) as { name: string; kind: string; message_id: string | null }[]) {
        if (!a.message_id) continue;
        byMsg.set(a.message_id, [...(byMsg.get(a.message_id) ?? []), { name: a.name, kind: a.kind }]);
      }
      initial = ((msgs ?? []) as { id: string; role: string; content: string }[]).filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as UIMsg["role"], content: m.content, ...(byMsg.has(m.id) ? { attachments: byMsg.get(m.id) } : {}) }));
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
  const options = modelOptions();
  const models = options.length > 1 ? [{ id: AUTO_MODEL, label: "Auto (best available)" }, ...options.map((o) => ({ id: o.id, label: o.label, vision: o.vision }))] : [];
  const initialModel = models.length ? resolveModel(await loadPreferredModel(supabase, user.id))?.id ?? AUTO_MODEL : AUTO_MODEL;
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
          initialPrompt={prefill} autoSend={!activeId && searchParams.send === "1" && typeof searchParams.q === "string" && !!searchParams.q.trim()} taskId={taskId} taskTitle={taskTitle} models={models} initialModel={initialModel}
          resumeTaskId={activeId && isUuid(searchParams.resume) ? searchParams.resume : undefined} />
      )}
    </AppShell>
  );
}
