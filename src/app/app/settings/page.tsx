import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page } from "@/components/ui/Card";
import { SettingsGroup, SettingsRow } from "@/components/SettingsList";
import { isAdminEmail } from "@/lib/server/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · TARGET" };

export default async function SettingsPage() {
  const { user } = await getSessionOrRedirect("/app/settings");
  const provider = user.app_metadata?.provider === "google" ? "Google" : "email and password";
  const email = user.email ?? "";
  const name = (user.user_metadata?.full_name as string | undefined) || email.split("@")[0];
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  return (
    <AppShell user={user} section="settings">
      <Page>
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Settings</h1>

          <section aria-label="Profile" data-testid="settings-profile" className="mt-6 flex items-center gap-4 rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-accent text-xl font-semibold uppercase text-accent-ink">{name.charAt(0) || "T"}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink">{name}</p>
              <p className="truncate text-sm text-muted">{email}</p>
              <p className="mt-0.5 text-xs text-muted-soft">Signed in with {provider}</p>
            </div>
          </section>

          <SettingsGroup title="Earn">
            <SettingsRow href="/work" icon="coin" title="Work" description="Watch ads and earn coins" testId="settings-work" />
          </SettingsGroup>

          <SettingsGroup title="Apps & accounts">
            <SettingsRow href="/app/connectors" icon="plug" title="Connectors" description="Google, GitHub and more" />
            <SettingsRow href="/app/settings/sessions" icon="lock" title="Website sign-ins" description="Sites TARGET is signed in to, sign out any time" testId="settings-sessions" />
            <SettingsRow href="/app/settings/vault" icon="lock" title="Vault" description="Logins, cards and keys, encrypted" testId="settings-vault" />
            <SettingsRow href="/app/settings/browser" icon="apps" title="Browser tasks" description="Approve website tasks and see results" testId="settings-browser" />
          </SettingsGroup>

          <SettingsGroup title="Personalize">
            <SettingsRow href="/app/settings/pages" icon="doc" title="Pages" description="Shareable Pages TARGET made" testId="settings-pages" />
            <SettingsRow href="/app/settings/files" icon="doc" title="Files" description="PDFs and files TARGET made" testId="settings-files" />
            <SettingsRow href="/app/settings/quick-actions" icon="bolt" title="Quick actions" description="Shortcuts shown on Home" testId="settings-quick-actions" />
            <SettingsRow href="/app/scheduled" icon="clock" title="Scheduled prompts" description="Prompts that run on a schedule" />
            <SettingsRow href="/app/settings/notifications" icon="bell" title="Notifications" description="Phone alerts when scheduled work is done" testId="settings-notifications" />
          </SettingsGroup>

          <SettingsGroup title="Privacy">
            <SettingsRow href="/app/settings/privacy" icon="shield" title="Privacy & memory" description="Review or clear memories" testId="settings-privacy" />
            <SettingsRow href="/app/activity" icon="activity" title="Activity" description="Everything TARGET did for you" />
            {isAdminEmail(email) && <SettingsRow href="/app/settings/work-links" icon="coin" title="Work links" description="Ad links and coins (owner only)" testId="settings-work-links" />}
            {isAdminEmail(email) && <SettingsRow href="/app/settings/errors" icon="alert" title="Site errors" description="Errors from the live site (owner only)" testId="settings-errors" />}
          </SettingsGroup>

          <SettingsGroup title="About">
            <SettingsRow href="/terms" icon="doc" title="Terms of service" description="The rules for using TARGET" />
            <SettingsRow href="/privacy" icon="lock" title="Privacy policy" description="How your data is handled" />
          </SettingsGroup>

          <form action="/auth/signout" method="post" className="mt-8">
            <button data-testid="settings-signout" className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface/80 px-4 py-3.5 text-left text-sm font-medium text-danger backdrop-blur-xl transition hover:bg-surface-2">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-danger-subtle">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></svg>
              </span>
              Sign out
            </button>
          </form>
          <p className="mt-3 px-1 text-xs leading-relaxed text-muted-soft">Sign-in is handled by Supabase Auth. TARGET never sees or stores your password.</p>
        </div>
      </Page>
    </AppShell>
  );
}
