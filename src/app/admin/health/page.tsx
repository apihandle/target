import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { envStatus, runHealthChecks, type CheckState } from "@/lib/server/adminHealth";
import { Badge, type Tone } from "@/components/ui/Badge";
import { fmt, Panel, SectionHeading } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TONE: Record<CheckState, Tone> = { ok: "ok", down: "danger", not_configured: "neutral", unknown: "warn" };
const LABEL: Record<CheckState, string> = { ok: "OK", down: "Down", not_configured: "Not set up", unknown: "Check" };

export default async function AdminHealth() {
  const { db } = await requireAdminPage();
  const { checks, checkedAt } = await runHealthChecks(db);
  const env = envStatus();
  return (
    <>
      <SectionHeading title="System health" description={`Checked live at ${fmt(checkedAt)}. Env vars show only set / missing.`}
        actions={<Link href="/admin/health" prefetch={false} className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3" data-testid="health-recheck">Check again</Link>} />
      <div className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="health-checks">
        {checks.map((c) => (
          <Panel key={c.id} testId={`health-${c.id}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink">{c.name}</p>
              <Badge tone={TONE[c.state]}>{LABEL[c.state]}</Badge>
            </div>
            <p className="mt-1 break-words text-xs text-muted">{c.detail}{c.ms != null ? ` · ${c.ms} ms` : ""}</p>
          </Panel>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold text-ink">Environment variables</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="health-env">
        {env.map((g) => (
          <Panel key={g.group}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-soft">{g.group}</p>
            <ul className="mt-1.5 divide-y divide-line">
              {g.vars.map((v) => (
                <li key={v.name} className="flex items-center justify-between gap-2 py-1.5">
                  <code className="min-w-0 truncate font-mono text-[11px] text-ink-soft">{v.name}</code>
                  <span className={`text-xs font-medium ${v.set ? "text-ok" : "text-muted-soft"}`}>{v.set ? "set" : "missing"}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
