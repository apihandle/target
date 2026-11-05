import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadProviderStates } from "@/lib/server/providerStatus";
import { Badge } from "@/components/ui/Badge";
import { fmt, KV, Panel, SectionHeading } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminProviders() {
  const { db } = await requireAdminPage();
  const states = await loadProviderStates(db);
  return (
    <>
      <SectionHeading title="Browser providers" description="Cloud browsers used for browser jobs, tried in order until one starts. Updated each time a job starts a browser. Keys are never shown, only whether they are set." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="providers">
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
