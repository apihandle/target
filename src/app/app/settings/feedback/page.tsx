import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import FeedbackPanel from "@/components/FeedbackPanel";
import { Page, PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send feedback · TARGET" };

export default async function FeedbackPage() {
  const { user } = await getSessionOrRedirect("/app/settings/feedback");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Send feedback" /></div>
        <div className="mx-auto mt-6 max-w-2xl">
          <p className="mb-3 text-sm text-muted">Found a bug or have an idea? Tell the TARGET team. Only your message, its type and the page are sent.</p>
          <FeedbackPanel />
        </div>
      </Page>
    </AppShell>
  );
}
