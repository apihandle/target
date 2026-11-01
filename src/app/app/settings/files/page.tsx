import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import { FilesList } from "@/components/MyCreations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Files · TARGET" };

export default async function FilesPage() {
  const { user } = await getSessionOrRedirect("/app/settings/files");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Files" description="PDFs and other files TARGET made for you. Only you can download them." /></div>
        <div className="mx-auto mt-6 max-w-2xl"><FilesList /></div>
      </Page>
    </AppShell>
  );
}
