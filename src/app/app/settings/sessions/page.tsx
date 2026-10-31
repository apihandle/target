import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import SiteSessions from "@/components/SiteSessions";
import { Page, PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website sign-ins · TARGET" };

export default async function SessionsPage() {
  const { user } = await getSessionOrRedirect("/app/settings/sessions");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Website sign-ins" description="Websites TARGET is signed in to for you, such as ones you joined with your Gmail." /></div>
        <div className="mx-auto mt-6 max-w-2xl"><SiteSessions /></div>
      </Page>
    </AppShell>
  );
}
