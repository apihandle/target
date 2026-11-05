import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { Page } from "@/components/ui/Card";
import AdminNav from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/server/adminAuth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · TARGET", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#05090c" };

/**
 * /admin: only signed-in users listed in ADMIN_EMAILS. The proxy answers 404 first; this layout and every page
 * check again on the server (requireAdminPage → notFound()).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdminPage();
  return (
    <AppShell user={user} section="settings">
      <Page wide>
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-soft">Owner only</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Admin</h1>
        </header>
        <AdminNav />
        <div className="pb-8">{children}</div>
      </Page>
    </AppShell>
  );
}
