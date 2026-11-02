import { notFound } from "next/navigation";
import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import { Page, PageHeader } from "@/components/ui/Card";
import { isAdminEmail } from "@/lib/server/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site errors · TARGET" };

type Row = { id: string; source: string; message: string; url: string | null; fingerprint: string; created_at: string };

/** Owner-only: the latest errors from the live site, grouped by kind. */
export default async function ErrorsPage() {
  const { user } = await getSessionOrRedirect("/app/settings/errors");
  if (!isAdminEmail(user.email)) notFound();
  let rows: Row[] = [];
  let failed = false;
  try {
    const { data, error } = await createAdminClient().from("error_events").select("id, source, message, url, fingerprint, created_at").order("created_at", { ascending: false }).limit(200);
    if (error) failed = true; else rows = (data ?? []) as Row[];
  } catch { failed = true; }
  const groups = new Map<string, { row: Row; count: number }>();
  for (const r of rows) { const g = groups.get(r.fingerprint); if (g) g.count += 1; else groups.set(r.fingerprint, { row: r, count: 1 }); }
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Site errors" /></div>
        <div className="mx-auto mt-6 max-w-2xl space-y-2" data-testid="error-list">
          {failed && <p className="text-sm text-warn">Couldn&apos;t load errors. Check that migration 0009 has run and SUPABASE_SERVICE_ROLE_KEY is set.</p>}
          {!failed && groups.size === 0 && <p className="text-sm text-muted">No errors. All quiet.</p>}
          {Array.from(groups.values()).map(({ row, count }) => (
            <div key={row.fingerprint} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded-full border border-line-strong px-2 py-0.5 uppercase tracking-wide">{row.source}</span>
                <span>{fmt(row.created_at)}</span>
                {count > 1 && <span className="ml-auto text-accent">{count} times</span>}
              </div>
              <p className="mt-2 break-words text-sm text-ink">{row.message}</p>
              {row.url && <p className="mt-1 truncate text-xs text-muted-soft">{row.url}</p>}
            </div>
          ))}
        </div>
      </Page>
    </AppShell>
  );
}
