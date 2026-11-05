import Link from "next/link";
import { getAdminSettings } from "@/lib/server/adminSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance · TARGET", robots: { index: false } };

/**
 * Shown (via a proxy rewrite, URL unchanged) to signed-in non-admins while maintenance mode is on in /admin → Controls.
 * Opened directly when maintenance is off, it just points back to the app.
 */
export default async function MaintenancePage() {
  const { maintenance } = await getAdminSettings();
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-bg px-6 text-center text-ink">
      <div className="max-w-sm" data-testid="maintenance-page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" width={56} height={56} className="mx-auto h-14 w-14" />
        {maintenance.enabled ? (
          <>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">TARGET is down for maintenance</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">{maintenance.message || "We're making some improvements. Please check back in a little while."}</p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">TARGET is up and running</h1>
            <Link href="/app" className="mt-4 inline-flex h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-ink">Open TARGET</Link>
          </>
        )}
      </div>
    </main>
  );
}
