import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadOverview } from "@/lib/server/adminData";
import { loadActivitySeries, loadDashboard } from "@/lib/server/adminStats";
import { getAdminSettings } from "@/lib/server/adminSettings";
import { FEATURES, FEATURE_LABELS } from "@/lib/adminConfig";
import { countryName, flagOf } from "@/lib/presence";
import ActivityChart from "@/components/admin/ActivityChart";
import { Donut, PctBar, SparkBars } from "@/components/admin/charts";
import { fmt, num, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

type Tone = "gold" | "green" | "blue" | "red";
const TONE: Record<Tone, { tile: string; icon: string; spark: string; card: string }> = {
  gold: { tile: "bg-accent/15 ring-accent/30", icon: "text-accent", spark: "text-accent", card: "from-accent/[0.07]" },
  green: { tile: "bg-ok/15 ring-ok/30", icon: "text-ok", spark: "text-ok", card: "from-ok/[0.07]" },
  blue: { tile: "bg-info/15 ring-info/30", icon: "text-info", spark: "text-info", card: "from-info/[0.07]" },
  red: { tile: "bg-danger/15 ring-danger/30", icon: "text-danger", spark: "text-danger", card: "from-danger/[0.09]" },
};
const ICON: Record<string, ReactNode> = {
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.6 2.7 2.2 3 4.7" /></>,
  live: <><path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0" /><circle cx="12" cy="18.5" r="1.2" /><path d="M2 9.5a14.5 14.5 0 0 1 20 0" /></>,
  chat: <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1z" />,
  error: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
};

function StatCard({ tone, icon, label, value, sub, delta, deltaTone = "up", spark, sparkLabel, testId }: {
  tone: Tone; icon: string; label: string; value: string; sub?: string; delta?: string; deltaTone?: "up" | "down" | "bad" | "flat"; spark: number[]; sparkLabel: string; testId: string;
}) {
  const t = TONE[tone];
  const dc = deltaTone === "bad" ? "text-danger" : deltaTone === "down" ? "text-warn" : deltaTone === "flat" ? "text-muted" : "text-ok";
  return (
    <div data-testid={testId} className={`relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br ${t.card} to-transparent bg-surface/80 p-4`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-1 ${t.tile}`}>
          <svg viewBox="0 0 24 24" className={`h-5 w-5 ${t.icon}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[icon]}</svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink-soft">{label}</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-ink sm:text-[26px]">{value}</p>
        </div>
        <SparkBars values={spark} className={t.spark} label={sparkLabel} />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-2 text-xs">
        {delta && <span className={`font-medium ${dc}`}>{deltaTone === "up" || deltaTone === "bad" ? "↑ " : deltaTone === "down" ? "↓ " : ""}{delta}</span>}
        {sub && <span className="text-muted">{sub}</span>}
      </p>
    </div>
  );
}

function Card({ title, dot, action, children, testId, className = "" }: { title: ReactNode; dot?: string; action?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section data-testid={testId} className={`rounded-2xl border border-line bg-surface/80 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">{dot && <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />}{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const viewAll = (href: string, testId: string) => <Link href={href} data-testid={testId} className="text-xs font-medium text-accent hover:underline">View all →</Link>;

const CAT_TONE: Record<string, string> = {
  task: "border-info/30 bg-info-subtle text-info", approval: "border-warn/30 bg-warn-subtle text-warn", outcome: "border-ok/30 bg-ok-subtle text-ok",
  project: "border-accent/30 bg-accent-subtle text-accent-strong", panel: "border-accent/30 bg-accent-subtle text-accent-strong",
  connection: "border-info/30 bg-info-subtle text-info", memory: "border-line-strong bg-surface-2 text-ink-soft",
};
const SRC_TONE: Record<string, string> = { server: "border-danger/30 bg-danger-subtle text-danger", client: "border-warn/30 bg-warn-subtle text-warn", cron: "border-info/30 bg-info-subtle text-info" };
const Tag = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

export default async function AdminDashboard() {
  const { db } = await requireAdminPage();
  const [d, o, series, settings] = await Promise.all([loadDashboard(db), loadOverview(db), loadActivitySeries(db, "24h"), getAdminSettings(db)]);
  const off = FEATURES.filter((f) => !settings.features[f]);
  const failed = d.users.total == null && d.messages.today == null;
  const jobsDone = d.jobs.done + d.jobs.failed;
  const successPct = jobsDone ? Math.round((d.jobs.done / jobsDone) * 100) : null;
  const activeDelta = d.active.today != null && d.active.yesterday != null ? d.active.today - d.active.yesterday : null;

  return (
    <div className="space-y-4" data-testid="admin-dashboard">
      {failed && <p role="alert" data-testid="admin-error" className="rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2.5 text-sm text-danger">Couldn&apos;t read the database. Check SUPABASE_SERVICE_ROLE_KEY. <Link href="/admin" className="underline">Retry</Link></p>}
      {(settings.maintenance.enabled || off.length > 0 || settings.announcement.enabled) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-warn/30 bg-warn-subtle px-3 py-2.5 text-sm text-warn" data-testid="overview-alerts">
          {settings.maintenance.enabled && <span>Maintenance mode is ON.</span>}
          {settings.announcement.enabled && <span>Announcement banner is showing.</span>}
          {off.length > 0 && <span>Switched off: {off.map((f) => FEATURE_LABELS[f].title).join(", ")}.</span>}
          <Link href="/admin/controls" className="ml-auto text-xs underline">Controls</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="overview-stats">
        <StatCard testId="stat-users" tone="gold" icon="users" label="Total users" value={num(d.users.total)} delta={d.users.newWeek != null ? `+${num(d.users.newWeek)} this week` : undefined} deltaTone={d.users.newWeek ? "up" : "flat"} spark={d.users.spark} sparkLabel="New users per day, last 14 days" />
        <StatCard testId="stat-active" tone="green" icon="live" label="Active today" value={num(d.active.today)}
          sub={d.active.now15 != null ? `${num(d.active.now15)} active now (15 min)` : "Presence starts after migration 0019"}
          delta={activeDelta != null ? `${activeDelta >= 0 ? "+" : ""}${activeDelta} vs yesterday` : undefined} deltaTone={activeDelta == null || activeDelta === 0 ? "flat" : activeDelta > 0 ? "up" : "down"}
          spark={d.active.spark} sparkLabel="Active users per day, last 14 days" />
        <StatCard testId="stat-messages" tone="blue" icon="chat" label="Messages today" value={num(d.messages.today)} sub={`${num(d.messages.chatsToday)} new chats today`} spark={d.messages.spark} sparkLabel="Messages per day, last 14 days" />
        <StatCard testId="stat-errors" tone="red" icon="error" label="Errors (24 h)" value={num(d.errors.last24h)} delta={d.errors.today != null ? `+${num(d.errors.today)} today` : undefined} deltaTone={d.errors.today ? "bad" : "flat"} spark={d.errors.spark} sparkLabel="Errors per 2 hours, last 24 hours" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2"><ActivityChart initial={{ buckets: series.buckets, error: series.error, capped: series.capped }} /></div>
        <Card title="Browser job status" action={<span className="text-[11px] text-muted">last 7 days</span>} testId="jobs-donut">
          {d.jobs.error ? <p role="alert" className="py-8 text-center text-sm text-danger">Couldn&apos;t load browser jobs. <Link href="/admin" className="underline">Retry</Link></p>
            : d.jobs.total === 0 ? <p className="py-8 text-center text-sm text-muted">No browser jobs in the last 7 days.</p> : (
            <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
              <Donut centre={num(d.jobs.total)} sub="jobs" slices={[
                { label: "Done", value: d.jobs.done, color: "#5fd08a" }, { label: "Failed", value: d.jobs.failed, color: "#f47c7c" },
                { label: "Running", value: d.jobs.running, color: "#e6c487" }, { label: "Waiting", value: d.jobs.waiting, color: "#4898e6" }, { label: "Cancelled", value: d.jobs.cancelled, color: "#66777b" },
              ]} />
              <ul className="w-full space-y-2 text-sm">
                {([["Done", d.jobs.done, "bg-ok"], ["Failed", d.jobs.failed, "bg-danger"], ["Running", d.jobs.running, "bg-accent"], ["Waiting / approval", d.jobs.waiting, "bg-sky-accent"], ["Cancelled", d.jobs.cancelled, "bg-muted-soft"]] as const).map(([l, v, c]) => (
                  <li key={l} className="flex items-center gap-2"><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${c}`} /><span className="flex-1 text-ink-soft">{l}</span><span className="tabular-nums text-ink">{num(v)}</span><span className="w-12 text-right tabular-nums text-muted">{d.jobs.total ? `${Math.round((v / d.jobs.total) * 100)}%` : "—"}</span></li>
                ))}
                {successPct != null && <li className="pt-1 text-xs text-muted">Success rate {successPct}% of finished jobs</li>}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card title={<>Users by country <span className="font-normal text-muted">({num(d.presenceUsers)} seen)</span></>} dot="bg-ok shadow-[0_0_8px_#5fd08a]" className="xl:col-span-2" testId="countries">
          {!d.presenceReady ? <p className="py-6 text-center text-sm text-muted">Country data starts once migration 0019 has run; it fills in as people use the app.</p>
            : d.countries.length === 0 ? <p className="py-6 text-center text-sm text-muted">No visits recorded yet. Countries appear as people use the app.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-soft"><th className="pb-2 font-medium">Country</th><th className="pb-2 text-right font-medium">Users</th><th className="w-[38%] pb-2 pl-4 font-medium">Share</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.countries.map((c, i) => (
                  <tr key={c.code ?? "unknown"} data-testid="country-row">
                    <td className="py-2 pr-2"><span className="inline-flex min-w-0 items-center gap-2"><span aria-hidden className="w-6 text-center text-base leading-none">{c.code && c.code !== "others" ? flagOf(c.code) : "◌"}</span><span className="truncate text-ink">{c.code === "others" ? "Others" : countryName(c.code)}</span></span></td>
                    <td className="py-2 text-right tabular-nums text-ink">{num(c.users)}</td>
                    <td className="py-2 pl-4"><span className="flex items-center gap-2"><span className={`w-11 text-right text-xs tabular-nums ${i === 0 ? "text-accent" : "text-muted"}`}>{c.pct.toFixed(1)}%</span><PctBar pct={c.pct} className={i === 0 ? "bg-accent" : "bg-ok/70"} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Devices & browsers" testId="devices" action={<span className="text-[11px] text-muted">by user</span>}>
          {d.devices.length === 0 ? <p className="py-6 text-center text-sm text-muted">{d.presenceReady ? "No devices recorded yet." : "Starts once migration 0019 has run."}</p> : (
            <ul className="space-y-2.5">
              {d.devices.map((v, i) => (
                <li key={v.label}>
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate text-ink-soft">{v.label}</span><span className="shrink-0 tabular-nums text-muted">{num(v.users)} · {v.pct.toFixed(1)}%</span></div>
                  <div className="mt-1"><PctBar pct={v.pct} className={i === 0 ? "bg-accent" : "bg-sky-accent/80"} /></div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-soft">AI usage per model isn&apos;t logged yet, so this shows devices instead.</p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="overview-more">
        {([["New · 30 days", o.new30], ["Active · 7 days", o.active7], ["Chats (all)", o.chats], ["Messages (all)", o.messages], ["Browser jobs today", o.jobsToday], ["New · 7 days", o.new7]] as const).map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line bg-surface/60 px-3 py-2.5"><p className="text-[11px] text-muted">{l}</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{num(v)}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Recent activity" dot="bg-ok" action={viewAll("/admin/activity", "activity-view-all")} testId="recent-activity">
          {d.activity.length === 0 ? <p className="py-6 text-center text-sm text-muted">No activity yet.</p> : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-soft"><th className="pb-2 font-medium">Time</th><th className="pb-2 font-medium">User</th><th className="pb-2 font-medium">What</th><th className="pb-2 text-right font-medium">Type</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.activity.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">{time(a.created_at)}</td>
                      <td className="max-w-[140px] truncate py-2 pr-3"><Link href={`/admin/users/${a.user_id}`} className="text-accent hover:underline">{a.email || a.user_id.slice(0, 8)}</Link></td>
                      <td className="py-2 pr-3 text-ink-soft">{truncate(a.title, 70)}</td>
                      <td className="py-2 text-right"><Tag cls={CAT_TONE[a.category] ?? CAT_TONE.memory}>{a.category}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={<>Recent errors <span className="font-normal text-danger">({num(d.errors.last24h)} in 24 h)</span></>} dot="bg-danger" action={viewAll("/admin/errors", "errors-view-all")} testId="recent-errors">
          {d.recentErrors.length === 0 ? <p className="py-6 text-center text-sm text-muted">No errors. All quiet.</p> : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-soft"><th className="pb-2 font-medium">Time</th><th className="pb-2 font-medium">Message</th><th className="pb-2 text-right font-medium">Source</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.recentErrors.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">{time(e.created_at)}</td>
                      <td className="py-2 pr-3 text-danger/90"><span className="mr-1" aria-hidden>⚠</span>{truncate(e.message, 90)}</td>
                      <td className="py-2 text-right"><Tag cls={SRC_TONE[e.source] ?? SRC_TONE.server}>{e.source}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {d.capped && <p className="text-xs text-warn">Some charts count only the newest 20,000 rows.</p>}
      <p className="text-[11px] text-muted-soft">Times in IST. Updated {fmt(new Date().toISOString())}.</p>
    </div>
  );
}
