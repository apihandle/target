import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import NotificationsToggle from "@/components/NotificationsToggle";
import { Page, PageHeader } from "@/components/ui/Card";
import { isAdminEmail } from "@/lib/server/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications · TARGET" };

export default async function NotificationsPage() {
  const { user } = await getSessionOrRedirect("/app/settings/notifications");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Notifications" /></div>
        <div className="mx-auto mt-6 max-w-2xl space-y-3">
          {key ? <NotificationsToggle publicKey={key} /> : (
            <p className="rounded-2xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn" data-testid="push-unconfigured">Notifications aren&apos;t set up on this server yet.</p>
          )}
          {isAdminEmail(user.email) && (
            <p className="px-1 text-sm text-muted">You&apos;re the site owner, so this device also gets an alert when the site has an error.</p>
          )}
        </div>
      </Page>
    </AppShell>
  );
}
