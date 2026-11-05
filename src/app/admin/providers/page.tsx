import { requireAdminPage } from "@/lib/server/adminAuth";
import { capabilities, loadProviderStates } from "@/lib/server/providerStatus";
import { Badge } from "@/components/ui/Badge";
import { fmt, KV, Panel, SectionHeading } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminProviders() {
  const { db } = await requireAdminPage();
  const states = await loadProviderStates(db);
  return (
    <>
      <SectionHeading title="Browser providers" description="Cloud browsers used for browser jobs, tried in order until one starts. Updated each time a job starts a browser. Keys are never shown, only whether they are set." />
      <h3 className="mt-4 text-sm font-semibold text-ink">What works</h3>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface/80 px-4" data-testid="capabilities">
        {capabilities().map((c) => (
          <li key={c.name} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
            <span className="shrink-0"><Badge tone={c.works ? "ok" : "neutral"}>{c.works ? "Works" : "Not available"}</Badge></span>
            <span className="min-w-0 text-sm"><span className="font-medium text-ink">{c.name}</span><span className="text-muted [overflow-wrap:anywhere]"> · {c.reason}</span></span>
          </li>
        ))}
      </ul>
      <h3 className="mt-6 text-sm font-semibold text-ink">Providers</h3>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="providers">
        {states.map((p) => {
          const status = !p.keyPresent ? { t: "No key", tone: "neutral" as const }
            : p.limit ? { t: "Out of credit / limit", tone: "danger" as const }
            : p.lastErrorAt && (!p.lastOkAt || p.lastErrorAt > p.lastOkAt) ? { t: "Last start failed", tone: "warn" as const }
            : p.lastOkAt ? { t: "Working", tone: "ok" as const } : { t: "Not used yet", tone: "neutral" as const };
          return (
            <Panel key={p.id} testId={`provider-${p.id}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{p.name}</h3>
                <Badge tone={status.tone}>{status.t}</Badge>
              </div>
              <dl className="mt-2 divide-y divide-line">
                <KV k="Key" v={p.keyPresent ? "Set" : "Missing"} />
                <KV k="Last success" v={fmt(p.lastOkAt)} />
                <KV k="Last error" v={fmt(p.lastErrorAt)} />
              </dl>
              {p.lastError && <p className="mt-2 text-xs text-danger [overflow-wrap:anywhere]">{p.lastError}</p>}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
