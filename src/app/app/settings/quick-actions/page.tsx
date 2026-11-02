import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import QuickActionsEditor from "@/components/QuickActionsEditor";
import { Page, PageHeader } from "@/components/ui/Card";
import { SettingsBack } from "@/components/SettingsList";
import { loadSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quick actions · TARGET" };

export default async function QuickActionsPage() {
  const { supabase, user } = await getSessionOrRedirect("/app/settings/quick-actions");
  const settings = await loadSettings(supabase, user.id);
  return (
    <AppShell user={user} section="settings">
      <Page>
        <div className="mx-auto max-w-2xl">
          <SettingsBack />
          <div className="mt-3"><PageHeader title="Quick actions" /></div>
          <div className="mt-8"><QuickActionsEditor initial={settings.quick_actions} hidden={settings.hidden_quick_actions} /></div>
        </div>
      </Page>
    </AppShell>
  );
}
