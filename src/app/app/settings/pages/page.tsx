import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import { PagesList } from "@/components/MyCreations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pages · TARGET" };

export default async function PagesPage() {
  const { user } = await getSessionOrRedirect("/app/settings/pages");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Pages" description="Public Pages TARGET made for you. Anyone with the link can view a public Page." /></div>
        <div className="mx-auto mt-6 max-w-2xl"><PagesList /></div>
      </Page>
    </AppShell>
  );
}
