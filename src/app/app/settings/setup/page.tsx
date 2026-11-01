import { notFound } from "next/navigation";
import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import { canSeeSetup, runSetupCheck, type Check } from "@/lib/server/setupCheck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup check · TARGET" };

function Mark({ ok, required }: { ok: boolean; required: boolean }) {
  return ok ? (
    <span aria-label="Done" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  ) : (
    <span aria-label={required ? "Missing" : "Optional, not set"} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${required ? "bg-danger-subtle text-danger" : "bg-surface-2 text-muted"}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d={required ? "M12 7v6M12 17h.01" : "M7 12h10"} /></svg>
    </span>
  );
}

function Group({ title, items, testId }: { title: string; items: Check[]; testId: string }) {
  const done = items.filter((c) => c.ok).length;
  return (
    <section className="mt-6" data-testid={testId}>
      <h2 className="flex items-center px-1 text-xs font-semibold uppercase tracking-wider text-muted-soft">{title}<span className="ml-auto normal-case tracking-normal">{done} of {items.length} done</span></h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface/80 backdrop-blur-xl">
        {items.map((c) => (
          <li key={c.key} className="flex items-start gap-3 px-4 py-3" data-testid="setup-item" data-ok={c.ok ? "1" : "0"}>
            <Mark ok={c.ok} required={c.required} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{c.label}{!c.required && <span className="ml-2 text-xs font-normal text-muted-soft">optional</span>}</p>
              {!c.ok && <p className="mt-0.5 text-xs leading-relaxed text-muted">{c.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What is still missing to run TARGET fully: env keys (presence only), database migrations, and the worker. */
export default async function SetupPage() {
  const { user } = await getSessionOrRedirect("/app/settings/setup");
  if (!canSeeSetup(user.email)) notFound();
  const r = await runSetupCheck();
  const missing = [...r.env, ...r.db].filter((c) => c.required && !c.ok).length;
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Setup check" description={missing ? `${missing} required step${missing > 1 ? "s" : ""} left. Each line says where to fix it.` : "Everything required is set up."} /></div>
        <div className="mx-auto max-w-2xl">
          <Group title="Keys on Vercel" items={r.env} testId="setup-env" />
          <Group title="Database" items={r.db} testId="setup-db" />
          <Group title="Worker" items={[r.worker]} testId="setup-worker" />
          <p className="mt-4 px-1 text-xs leading-relaxed text-muted-soft">Only whether a key exists is checked. Values are never shown. After adding a key on Vercel, redeploy so it takes effect.</p>
        </div>
      </Page>
    </AppShell>
  );
}
