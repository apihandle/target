"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export type NavBadges = { users: number | null; errors24h: number | null; jobsActive: number | null; scheduledActive: number | null; sharesActive: number | null; feedbackNew?: number | null; switchesOff: number };

const ICONS: Record<string, ReactNode> = {
  dashboard: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.6 2.7 2.2 3 4.7" /></>,
  errors: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
  jobs: <><rect x="3.5" y="4.5" width="17" height="13" rx="2" /><path d="M3.5 8.5h17M8 21h8M12 17.5V21" /></>,
  scheduled: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  shares: <><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="6" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="m8.7 10.8 6.6-3.6M8.7 13.2l6.6 3.6" /></>,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  ai: <><rect x="6" y="6" width="12" height="12" rx="2.5" /><path d="M9.5 10h5M9.5 14h3M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>,
  feedback: <><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1z" /><path d="M9 10h6M9 13h4" /></>,
  health: <path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z" />,
  controls: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  approvals: <><path d="M5 12.5 9.5 17 19 7.5" /></>,
  providers: <><rect x="3.5" y="5" width="17" height="5" rx="1.5" /><rect x="3.5" y="14" width="17" height="5" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  audit: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
};

type Tone = "neutral" | "danger" | "ok" | "warn";
const TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-ink-soft",
  danger: "border-danger/40 bg-danger text-[#1b0a0a]",
  ok: "border-ok/40 bg-ok text-[#06150c]",
  warn: "border-warn/40 bg-warn text-[#1d1606]",
};

function Badge({ n, tone }: { n: number | null; tone: Tone }) {
  if (n == null || (tone !== "neutral" && n === 0)) return null;
  return <span className={`ml-auto min-w-[28px] rounded-full border px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums ${TONES[tone]}`}>{n > 99999 ? "99k+" : n.toLocaleString("en-IN")}</span>;
}

function Icon({ name }: { name: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>;
}

/**
 * The admin frame: left sidebar with count badges (a drawer on phones), top bar with global search, system status,
 * the 24 h error bell and the admin's avatar. Layout only; every number arrives from the server.
 */
export default function AdminFrame({ badges, version, email, avatar, statusSlot, children }: {
  badges: NavBadges; version: string; email: string; avatar?: string; statusSlot: ReactNode; children: ReactNode;
}) {
  const path = usePathname() ?? "/admin";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items: { href: string; label: string; icon: string; badge?: ReactNode }[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard" },
    { href: "/admin/users", label: "Users", icon: "users", badge: <Badge n={badges.users} tone="neutral" /> },
    { href: "/admin/errors", label: "Errors", icon: "errors", badge: <Badge n={badges.errors24h} tone="danger" /> },
    { href: "/admin/jobs", label: "Browser jobs", icon: "jobs", badge: <Badge n={badges.jobsActive} tone="ok" /> },
    { href: "/admin/approvals", label: "Approvals", icon: "approvals" },
    { href: "/admin/providers", label: "Browser providers", icon: "providers" },
    { href: "/admin/scheduled", label: "Scheduled", icon: "scheduled", badge: <Badge n={badges.scheduledActive} tone="neutral" /> },
    { href: "/admin/shares", label: "Share links", icon: "shares", badge: <Badge n={badges.sharesActive} tone="neutral" /> },
    { href: "/admin/activity", label: "Activity", icon: "activity" },
    { href: "/admin/ai-usage", label: "AI usage", icon: "ai" },
    { href: "/admin/feedback", label: "Feedback", icon: "feedback", badge: <Badge n={badges.feedbackNew ?? null} tone="warn" /> },
    { href: "/admin/health", label: "Health", icon: "health" },
    { href: "/admin/controls", label: "Controls", icon: "controls", badge: <Badge n={badges.switchesOff} tone="warn" /> },
    { href: "/admin/audit", label: "Audit log", icon: "audit" },
  ];
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  const initial = (email || "A").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-[100dvh] bg-bg text-ink">
      <a href="#admin-main" className="sr-only-focusable fixed left-2 top-2 z-[60] rounded bg-accent px-3 py-2 text-sm text-accent-ink">Skip to content</a>
      {open && <div aria-hidden className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
      <aside id="admin-nav" aria-label="Admin" data-testid="admin-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-[#071014]/95 p-3 backdrop-blur-xl transition-transform lg:sticky lg:top-0 lg:h-[100dvh] lg:w-64 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-2 pb-4 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width={36} height={36} className="h-9 w-9" />
          <div className="min-w-0 leading-none">
            <span className="font-script text-3xl leading-none text-stucco">Target</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Admin</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink lg:hidden">
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} onClick={() => setOpen(false)} aria-current={active(it.href) ? "page" : undefined} data-testid={`admin-nav-${it.icon}`}
                  className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${active(it.href) ? "border border-accent/30 bg-gradient-to-r from-accent/20 to-accent/5 text-accent-strong shadow-[inset_0_0_0_1px_rgba(230,196,135,0.08)]" : "border border-transparent text-muted hover:bg-surface-2 hover:text-ink"}`}>
                  <Icon name={it.icon} />
                  <span className="truncate">{it.label}</span>
                  {it.badge}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3 rounded-2xl border border-line bg-surface/80 p-3" data-testid="admin-version">
          <p className="text-xs font-semibold text-ink">TARGET</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{version}</p>
          <Link href="/app" className="mt-2 inline-flex text-xs font-medium text-accent hover:underline">← Back to the app</Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-xl sm:gap-3 sm:px-5">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-controls="admin-nav" aria-expanded={open} data-testid="admin-menu"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2 lg:hidden">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <form action="/admin/search" method="get" role="search" className="relative min-w-0 flex-1 sm:max-w-md">
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input type="search" name="q" placeholder="Search email, job id, error…" aria-label="Search users, browser jobs and errors" data-testid="admin-search"
              className="h-10 w-full rounded-full border border-line-strong bg-surface/80 pl-10 pr-4 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent" />
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {statusSlot}
            <Link href="/admin/errors" aria-label={`${badges.errors24h ?? 0} errors in the last 24 hours`} data-testid="admin-bell" className="relative grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-surface-2">
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
              {!!badges.errors24h && <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[18px] text-[#1b0a0a]">{badges.errors24h > 99 ? "99+" : badges.errors24h}</span>}
            </Link>
            <span className="flex items-center gap-2" title={email}>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full border border-line-strong object-cover" />
              ) : (
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{initial}</span>
              )}
              <span className="hidden max-w-[160px] truncate text-sm text-ink-soft xl:block">{email}</span>
            </span>
          </div>
        </header>
        <main id="admin-main" className="min-w-0 flex-1 px-3 pb-12 pt-4 sm:px-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
