"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const ADMIN_TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/errors", label: "Errors" },
  { href: "/admin/jobs", label: "Browser jobs" },
  { href: "/admin/scheduled", label: "Scheduled" },
  { href: "/admin/shares", label: "Share links" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/controls", label: "Controls" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

/** Section tabs: one scrollable row on a phone, wraps on wider screens. */
export default function AdminNav() {
  const path = usePathname() ?? "/admin";
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Admin sections" className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1.5 pb-1 sm:w-auto sm:flex-wrap">
        {ADMIN_TABS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={active(t.href) ? "page" : undefined} data-testid={`admin-tab-${t.href.split("/")[2] ?? "overview"}`}
              className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition ${active(t.href) ? "border-accent/40 bg-accent-subtle text-accent-strong" : "border-line bg-surface/80 text-muted hover:bg-surface-2 hover:text-ink"}`}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
