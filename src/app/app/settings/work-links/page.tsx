import { notFound } from "next/navigation";
import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import WorkLinksManager from "@/components/WorkLinksManager";
import { Page, PageHeader } from "@/components/ui/Card";
import { isAdminEmail } from "@/lib/server/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work links · TARGET" };

export default async function WorkLinksPage() {
  const { user } = await getSessionOrRedirect("/app/settings/work-links");
  if (!isAdminEmail(user.email)) notFound();
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Work links" description="The ad links on the Work page, and how many coins each view earns." /></div>
        <div className="mx-auto mt-6 max-w-2xl"><WorkLinksManager /></div>
      </Page>
    </AppShell>
  );
}
