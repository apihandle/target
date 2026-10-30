import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/PwaRegister";

/**
 * Layout for the signed-in workspace (/app/*) only. Adds the installable-app manifest and registers
 * the /app service worker. The public landing page and the root layout are untouched.
 */
export const metadata: Metadata = {
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "TARGET", statusBarStyle: "black-translucent" },
  icons: { apple: "/app-icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#05090c",
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PwaRegister />
    </>
  );
}
