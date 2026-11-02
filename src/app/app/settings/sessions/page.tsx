import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import SiteSessions from "@/components/SiteSessions";
import { Page, PageHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website sign-ins · TARGET" };

export default async function SessionsPage() {
  const { user, supabase: db } = await getSessionOrRedirect("/app/settings/sessions");
  const { data: g } = await db.from("connections").select("status, account_label").eq("user_id", user.id).eq("connector_id", "google").maybeSingle();
  const google = g ? { status: String(g.status ?? "connected"), email: String(g.account_label ?? "") } : null;
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Website sign-ins" /></div>
        <div className="mx-auto mt-6 max-w-2xl"><SiteSessions google={google} /></div>
      </Page>
    </AppShell>
  );
}
