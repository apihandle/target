import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import Connections from "@/components/Connections";
import { Page, PageHeader } from "@/components/ui/Card";
import { integrationViews } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected apps · TARGET" };

const NOTICES: Record<string, string> = {
  setup: "That app isn't set up on this server yet.",
  denied: "You cancelled the connection. Nothing was connected.",
  state: "The connection request expired or didn't match your session. Please try again.",
  exchange: "The provider didn't complete the connection. Please try again.",
  scope: "The required permission wasn't granted, so nothing was connected.",
  unknown: "Unknown app.",
};

export default async function ConnectionsPage({ searchParams }: { searchParams: { error?: string; connected?: string } }) {
  const { supabase, user } = await getSessionOrRedirect("/app/settings/connections");
  const { data, error } = await supabase.from("connections").select("provider, account_label, connected_at").eq("user_id", user.id);
  const views = integrationViews(process.env, data ?? []);
  const notice = searchParams.error ? NOTICES[searchParams.error] ?? "Something went wrong." : null;
  return (
    <AppShell user={user} section="settings">
      <Page>
        <a href="/app/settings" className="text-xs text-muted hover:text-ink">← Settings</a>
        <div className="mt-3"><PageHeader title="Connected apps" description="TARGET only uses an app you connect for the actions listed, and only after you approve each one. Disconnect any time." /></div>
        {notice && <p role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">{notice}</p>}
        {searchParams.connected && !notice && <p role="status" className="mt-6 rounded-xl border border-ok/30 bg-ok-subtle px-4 py-3 text-sm text-ok">Connected.</p>}
        {error && <p role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">Connection status couldn&apos;t load (apply migration 0006). Apps are shown as not connected.</p>}
        <Connections initial={views} />
      </Page>
    </AppShell>
  );
}
