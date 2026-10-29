import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import MemoryManager from "@/components/MemoryManager";
import type { Memory } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memory · TARGET" };

export default async function MemoryPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/memory");
  const [{ data: convs }, { data: mems }] = await Promise.all([
    supabase.from("conversations").select("id, title").order("updated_at", { ascending: false }).limit(50),
    supabase.from("memories").select("id, content, source, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={convs ?? []} email={user.email ?? ""} section="memory" />
      <main className="flex-1 overflow-y-auto"><MemoryManager initial={(mems ?? []) as Memory[]} /></main>
    </div>
  );
}
