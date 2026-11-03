import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import PanelHome from "@/components/PanelHome";
import { PANEL_COLS, type Panel } from "@/lib/panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panels · TARGET" };

export default async function PanelsPage(props: { searchParams: Promise<{ new?: string }> }) {
  const searchParams = await props.searchParams;
  const { supabase, user } = await getSessionOrRedirect("/app/panels");
  const { data: panels, error } = await supabase.from("panels").select(PANEL_COLS).eq("user_id", user.id).order("position").order("created_at");
  return (
    <AppShell user={user} section="panels">
      {error && <p role="alert" className="mx-auto mt-16 max-w-3xl rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn md:mt-6">Panels couldn&apos;t load. If this is a new install, apply the migrations in supabase/migrations.</p>}
      <PanelHome initial={(panels ?? []) as Panel[]} startAdding={searchParams.new === "1"} />
    </AppShell>
  );
}
