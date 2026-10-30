import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { BUILTINS, builtinReady } from "@/lib/connectors/builtins";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connected apps · TARGET" };

export default async function ConnectionsPage() {
  const { user } = await getSessionOrRedirect("/app/settings/connections");
  return (
    <AppShell user={user} section="settings">
      <Page>
        <a href="/app/settings" className="text-xs text-muted hover:text-ink">← Settings</a>
        <div className="mt-3">
          <PageHeader title="Connected apps" description="Your own accounts (Supabase, Vercel, GitHub, Google and more) are managed on the Connectors page. Below are the services this TARGET server uses for everyone."
            actions={<LinkButton href="/app/connectors" variant="primary" data-testid="open-connectors">Manage connectors</LinkButton>} />
        </div>
        <div className="mt-8 space-y-3">
          {BUILTINS.map((b) => {
            const ready = builtinReady(b, process.env);
            return (
              <article key={b.id} data-testid="builtin" data-id={b.id} className="rounded-xl2 border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{b.name}</h2>
                  <Badge tone={ready ? "ok" : "warn"}>{ready ? "Available" : "Setup required"}</Badge>
                  <span className="text-[11px] text-muted-soft">server-wide</span>
                </div>
                <p className="mt-1 text-sm text-muted">{b.description}</p>
                <p className="mt-2 text-xs text-muted">{b.dataAccess}</p>
                {!ready && <p className="mt-2 rounded-lg bg-warn-subtle px-3 py-2 text-xs text-warn">The site owner needs to set {b.anyEnv.map((e, n) => <span key={e}>{n > 0 && " or "}<code>{e}</code></span>)}.</p>}
              </article>
            );
          })}
        </div>
      </Page>
    </AppShell>
  );
}
