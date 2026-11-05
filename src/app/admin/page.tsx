import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadOverview } from "@/lib/server/adminData";
import { getAdminSettings } from "@/lib/server/adminSettings";
import { FEATURES, FEATURE_LABELS } from "@/lib/adminConfig";
import { num, SectionHeading, Stat } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const { db } = await requireAdminPage();
  const [o, settings] = await Promise.all([loadOverview(db), getAdminSettings(db)]);
  const off = FEATURES.filter((f) => !settings.features[f]);
  const failed = o.users == null && o.chats == null && o.messages == null;
  return (
    <>
      <SectionHeading title="Overview" description="Counts are live from the database. Today = since midnight IST." />
      {failed && <p role="alert" data-testid="admin-error" className="mt-3 rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2.5 text-sm text-danger">Couldn&apos;t read the database. Check SUPABASE_SERVICE_ROLE_KEY. <Link href="/admin" className="underline">Retry</Link></p>}
      {(settings.maintenance.enabled || off.length > 0 || settings.announcement.enabled) && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-warn/30 bg-warn-subtle px-3 py-2.5 text-sm text-warn" data-testid="overview-alerts">
          {settings.maintenance.enabled && <p>Maintenance mode is ON: /app is closed for non-admins.</p>}
          {settings.announcement.enabled && <p>Announcement banner is showing.</p>}
          {off.length > 0 && <p>Switched off: {off.map((f) => FEATURE_LABELS[f].title).join(", ")}.</p>}
          <Link href="/admin/controls" className="text-xs underline">Open Controls</Link>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-stats">
        <Stat label="Total users" value={num(o.users)} hint={o.usersCapped ? "First 20,000 counted" : undefined} testId="stat-users" />
        <Stat label="New · 7 days" value={num(o.new7)} />
        <Stat label="New · 30 days" value={num(o.new30)} />
        <Stat label="Active · 7 days" value={num(o.active7)} hint="Signed in or sent a message" />
        <Stat label="Chats" value={num(o.chats)} />
        <Stat label="Messages" value={num(o.messages)} />
        <Stat label="Browser jobs today" value={num(o.jobsToday)} />
        <Stat label="Errors · 24 h" value={num(o.errors24h)} testId="stat-errors" />
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        <Link href="/admin/users" className="rounded-2xl border border-line bg-surface/80 px-4 py-3 text-sm text-ink hover:bg-surface-2">Users →</Link>
        <Link href="/admin/errors" className="rounded-2xl border border-line bg-surface/80 px-4 py-3 text-sm text-ink hover:bg-surface-2">Errors →</Link>
        <Link href="/admin/health" className="rounded-2xl border border-line bg-surface/80 px-4 py-3 text-sm text-ink hover:bg-surface-2">System health →</Link>
      </div>
    </>
  );
}
