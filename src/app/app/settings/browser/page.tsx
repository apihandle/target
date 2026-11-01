import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import BrowserJobs from "@/components/BrowserJobs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browser tasks · TARGET" };

export default async function BrowsertasksPage() {
  const { user } = await getSessionOrRedirect("/app/settings/browser");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Browser tasks" description="Website, code and video tasks TARGET runs on its worker. Approve anything that clicks or types." /></div>
        <div className="mx-auto mt-6 max-w-2xl"><BrowserJobs /></div>
      </Page>
    </AppShell>
  );
}
