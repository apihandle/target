import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Chat, { type UIMsg } from "@/components/Chat";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";
export const metadata = { title: "TARGET" };

export default async function AppHome({ searchParams }: { searchParams: { c?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");

  const { data: convs } = await supabase.from("conversations").select("id, title").order("updated_at", { ascending: false }).limit(50);
  const activeId = searchParams.c;
  let initial: UIMsg[] = [];
  if (activeId) {
    const { data: msgs } = await supabase.from("messages").select("role, content").eq("conversation_id", activeId).order("created_at");
    initial = (msgs ?? []).filter((m) => m.role !== "system") as UIMsg[];
  }

  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={convs ?? []} activeId={activeId} email={user.email ?? ""} />
      <main className="flex-1 overflow-hidden">
        <Chat key={activeId ?? "new"} conversationId={activeId} initialMessages={initial} />
      </main>
    </div>
  );
}
