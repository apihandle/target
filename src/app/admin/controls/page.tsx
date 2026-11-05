import { requireAdminPage } from "@/lib/server/adminAuth";
import { loadAdminSettings } from "@/lib/server/adminSettings";
import ControlsPanel from "@/components/admin/ControlsPanel";
import { SectionHeading } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminControls() {
  const { db } = await requireAdminPage();
  // A fresh read (not the 15 s cache) so the page always shows what is saved; probe the table so a missing migration is obvious.
  const [settings, probe] = await Promise.all([loadAdminSettings(db), db.from("admin_settings").select("key", { count: "exact", head: true })]);
  const ready = !probe.error;
  return (
    <>
      <SectionHeading title="Controls" description="Site-wide switches. Changes reach every server within about 15 seconds." />
      {!ready && (
        <p role="alert" data-testid="controls-migration" className="mt-3 rounded-xl border border-warn/30 bg-warn-subtle px-3 py-2.5 text-sm text-warn">
          Controls need the admin tables. Run supabase/migrations/0019_admin.sql in the Supabase SQL editor; until then everything stays on and changes are refused.
        </p>
      )}
      <div className="mt-4">
        <ControlsPanel announcement={settings.announcement} maintenance={settings.maintenance} features={settings.features} cronReady={!!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16} />
      </div>
    </>
  );
}
