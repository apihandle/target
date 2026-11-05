import Link from "next/link";
import type { ReactNode } from "react";

/** Icons drawn as simple strokes (no emojis anywhere in the UI). */
const PATHS: Record<string, ReactNode> = {
  apps: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  plug: <><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z" /><path d="M12 16v5" /></>,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  chat: <><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1z" /><path d="M9 10h6M9 13h4" /></>,
  out: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
};

export function SettingsIcon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
    </span>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-soft">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface/80 backdrop-blur-xl">{children}</div>
    </section>
  );
}

export function SettingsRow({ href, icon, title, description, testId }: { href: string; icon: string; title: string; description: string; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2">
      <SettingsIcon name={icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-muted">{description}</span>
      </span>
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted-soft" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </Link>
  );
}

/** "Back to Settings" link used on every settings sub-page. */
export function SettingsBack() {
  return (
    <Link href="/app/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
      <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>
      Settings
    </Link>
  );
}
