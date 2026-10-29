import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import PanelHome from "@/components/PanelHome";
import type { Panel } from "@/lib/panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · TARGET" };

export default async function HomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/home");
  const [{ data: convs }, { data: panels }] = await Promise.all([
    supabase.from("conversations").select("id, title").order("updated_at", { ascending: false }).limit(50),
    supabase.from("panels").select("id, kind, title, config, data, error, refreshed_at, position").order("position").order("created_at"),
  ]);
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  const name = (meta?.full_name || meta?.name || "").split(" ")[0] || undefined;
  return (
    <div className="flex h-[100dvh]">
      <Sidebar conversations={convs ?? []} email={user.email ?? ""} section="home" />
      <main className="flex-1 overflow-y-auto"><PanelHome initial={(panels ?? []) as Panel[]} name={name} /></main>
    </div>
  );
}
