import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import CustomProviders from "@/components/CustomProviders";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI providers · TARGET" };

export default async function AiProvidersPage() {
  const { user } = await getSessionOrRedirect("/app/settings/ai-providers");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="AI providers" /></div>
        <div className="mx-auto mt-6 max-w-2xl"><CustomProviders /></div>
      </Page>
    </AppShell>
  );
}
