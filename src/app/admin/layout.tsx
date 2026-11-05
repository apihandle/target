import type { Metadata, Viewport } from "next";
import AdminFrame from "@/components/admin/AdminFrame";
import HealthPill from "@/components/admin/HealthPill";
import SessionKeeper from "@/components/SessionKeeper";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { getAdminSettings } from "@/lib/server/adminSettings";
import { loadNavCounts } from "@/lib/server/adminStats";
import { FEATURES } from "@/lib/adminConfig";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · TARGET", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#05090c" };

/**
 * /admin: only signed-in users listed in ADMIN_EMAILS. The proxy answers 404 first; this layout and every page
 * check again on the server (requireAdminPage → notFound()).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, db } = await requireAdminPage();
  const settings = await getAdminSettings(db);
  const badges = await loadNavCounts(db, FEATURES.filter((f) => !settings.features[f]).length);
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
  const version = `v${pkg.version} · ${sha || "local build"}`;
  return (
    <AdminFrame badges={badges} version={version} email={user.email ?? ""} avatar={(user.user_metadata?.avatar_url as string | undefined) || undefined} statusSlot={<HealthPill />}>
      <SessionKeeper />
      {children}
    </AdminFrame>
  );
}
