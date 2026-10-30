import Link from "next/link";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import QuickActionsEditor from "@/components/QuickActionsEditor";
import { Card, Page, PageHeader, SectionTitle } from "@/components/ui/Card";
import { loadSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · TARGET" };

export default async function SettingsPage() {
  const { supabase, user } = await getSessionOrRedirect("/app/settings");
  const settings = await loadSettings(supabase, user.id);
  const provider = user.app_metadata?.provider === "google" ? "Google" : "email and password";
  return (
    <AppShell user={user} section="settings">
      <Page>
        <PageHeader title="Settings" description="Your account, shortcuts, connected apps and privacy controls." />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/app/settings/connections" data-testid="settings-connections" className="rounded-xl2 border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2">
            <p className="font-medium">Connected apps</p>
            <p className="mt-1 text-xs text-muted">See what&apos;s connected, what each app can access, and disconnect.</p>
          </Link>
          <Link href="/app/settings/privacy" data-testid="settings-privacy" className="rounded-xl2 border border-line bg-surface p-4 hover:border-line-strong hover:bg-surface-2">
            <p className="font-medium">Privacy &amp; memory</p>
            <p className="mt-1 text-xs text-muted">Review, edit or clear what TARGET remembers, or turn memory off.</p>
          </Link>
        </div>
        <section aria-labelledby="qa-edit" className="mt-10">
          <SectionTitle id="qa-edit">Quick actions</SectionTitle>
          <p className="-mt-1 mb-3 text-xs text-muted">Shortcuts on Home. Each one opens a chat with its text filled in, so you can edit before sending. Nothing runs automatically.</p>
          <QuickActionsEditor initial={settings.quick_actions} hidden={settings.hidden_quick_actions} />
        </section>
        <section aria-labelledby="acct" className="mt-10">
          <SectionTitle id="acct">Account</SectionTitle>
          <Card>
            <p className="text-sm">{user.email}</p>
            <p className="mt-1 text-xs text-muted">Signed in with {provider}. Sign-in is handled by Supabase Auth; TARGET never sees or stores your password.</p>
            <form action="/auth/signout" method="post" className="mt-3"><button className="text-sm text-accent-strong underline">Sign out</button></form>
          </Card>
        </section>
      </Page>
    </AppShell>
  );
}
