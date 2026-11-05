import Link from "next/link";
import type { ReactNode } from "react";

/** Small building blocks for /admin, in the same style as the /app settings pages (cards on the night-water backdrop). */

export const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

export const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));

export function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function Panel({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div data-testid={testId} className={`rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl ${className}`}>{children}</div>;
}

export function SectionHeading({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: string; testId?: string }) {
  return (
    <Panel testId={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-soft">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Panel>
  );
}

export function Empty({ title, children, testId }: { title: string; children?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId ?? "admin-empty"} className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function LoadError({ children, retryHref }: { children: ReactNode; retryHref: string }) {
  return (
    <div role="alert" data-testid="admin-error" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2.5 text-sm text-danger">
      <span className="flex-1">{children}</span>
      <Link href={retryHref} className="rounded-full border border-danger/40 px-3 py-1 text-xs font-medium hover:bg-danger/15">Retry</Link>
    </div>
  );
}

/** Builds a URL for the same page with some query params changed (page resets unless given). */
export function hrefWith(base: string, params: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...params, page: undefined, ...change };
  const pairs = Object.entries(merged).filter((e): e is [string, string] => !!e[1] && !(e[0] === "page" && e[1] === "1"));
  const qs = new URLSearchParams(pairs).toString();
  return qs ? `${base}?${qs}` : base;
}

export function Pager({ base, params, page, pages, total }: { base: string; params: Record<string, string | undefined>; page: number; pages: number; total: number }) {
  if (total === 0) return null;
  const cls = "inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3";
  const off = "inline-flex h-9 min-w-[88px] items-center justify-center rounded-full border border-line px-3 text-xs font-medium text-muted-soft opacity-50";
  return (
    <nav aria-label="Pages" data-testid="admin-pager" className="mt-4 flex items-center justify-between gap-2">
      {page > 1 ? <Link className={cls} href={hrefWith(base, params, { page: String(page - 1) })}>← Newer</Link> : <span className={off}>← Newer</span>}
      <span className="text-xs tabular-nums text-muted">Page {page} of {pages} · {total.toLocaleString("en-IN")}</span>
      {page < pages ? <Link className={cls} href={hrefWith(base, params, { page: String(page + 1) })}>Older →</Link> : <span className={off}>Older →</span>}
    </nav>
  );
}

/** Filter pills (links, so they work without JavaScript and keep the URL shareable). */
export function Chips({ base, params, name, options, label }: { base: string; params: Record<string, string | undefined>; name: string; options: { value: string; label: string }[]; label: string }) {
  const current = params[name] ?? "";
  return (
    <div role="group" aria-label={label} className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
        {[{ value: "", label: "All" }, ...options].map((o) => (
          <Link key={o.value || "all"} href={hrefWith(base, params, { [name]: o.value || undefined })} aria-current={current === o.value ? "true" : undefined}
            className={`inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium ${current === o.value ? "border-accent/40 bg-accent-subtle text-accent-strong" : "border-line bg-surface/80 text-muted hover:text-ink"}`}>
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A GET search box (works without JavaScript). Other filters ride along as hidden fields. */
export function SearchBox({ base, params, name = "q", placeholder }: { base: string; params: Record<string, string | undefined>; name?: string; placeholder: string }) {
  return (
    <form action={base} method="get" role="search" className="mt-3 flex gap-2">
      {Object.entries(params).filter(([k, v]) => v && k !== name && k !== "page").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="search" name={name} defaultValue={params[name] ?? ""} placeholder={placeholder} aria-label={placeholder}
        className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-bg/80 px-4 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent" />
      <button type="submit" className="h-10 shrink-0 rounded-full border border-line-strong bg-surface-2 px-4 text-sm font-medium text-ink hover:bg-surface-3">Search</button>
    </form>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
    </div>
  );
}

export function sp(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= 200 ? s : undefined;
}
