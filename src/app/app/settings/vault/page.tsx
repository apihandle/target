import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import VaultManager from "@/components/VaultManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vault · TARGET" };

export default async function VaultPage() {
  const { user } = await getSessionOrRedirect("/app/settings/vault");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Vault" /></div>
        <div className="mx-auto mt-6 max-w-2xl"><VaultManager /></div>
      </Page>
    </AppShell>
  );
}
