"use client";
import { useState } from "react";
import Markdown from "@/components/Markdown";
import { calendarUrl } from "@/lib/actions";
import { faviconUrl, hostOfUrl, type Block } from "@/lib/blocks";

const card = "mt-3 overflow-hidden rounded-2xl border border-line bg-surface-2/70";
const cap = "text-[11px] font-medium uppercase tracking-wider text-muted";

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-testid="block-copy" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* blocked */ } }}
      className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-soft hover:bg-surface-3">
      {done ? "Copied" : label}
    </button>
  );
}

/** Link cards with favicon, title and host. Also used for web-search sources. */
export function LinkCards({ items, label }: { items: { title: string; url: string; description?: string }[]; label?: string }) {
  if (!items.length) return null;
  return (
    <div data-testid="block-links" className="mt-3">
      {label && <div className={`${cap} mb-1.5`}>{label}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((l, i) => (
          <a key={l.url + i} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/70 p-3 no-underline transition hover:bg-surface-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={faviconUrl(l.url)} alt="" width={20} height={20} loading="lazy" className="mt-0.5 h-5 w-5 shrink-0 rounded" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{l.title}</span>
              <span className="block truncate text-xs text-muted">{hostOfUrl(l.url)}</span>
              {l.description && <span className="mt-1 line-clamp-2 block text-xs text-ink-soft">{l.description}</span>}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function Blocks({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  return (
    <div data-testid="blocks">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "links": return <LinkCards key={i} items={b.items} />;
          case "table": return (
            <div key={i} data-testid="block-table" className={card}>
              {b.title && <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">{b.title}</div>}
              <div className="table-wrap overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr>{b.columns.map((c, j) => <th key={j} className="whitespace-nowrap px-4 py-2 text-xs font-medium text-muted">{c}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t border-line">{r.map((c, k) => <td key={k} className="px-4 py-2 align-top text-ink-soft">{/^https?:\/\/\S+$/.test(c) ? <a href={c} target="_blank" rel="noopener noreferrer">{hostOfUrl(c)}</a> : c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          );
          case "images": return (
            <div key={i} data-testid="block-images" className="mt-3 grid grid-cols-2 gap-2">
              {b.items.map((im, j) => (
                <figure key={j} className="overflow-hidden rounded-xl border border-line bg-surface-2/70">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt={im.caption ?? ""} loading="lazy" referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover" />
                  {im.caption && <figcaption className="px-2.5 py-1.5 text-xs text-muted">{im.caption}</figcaption>}
                </figure>
              ))}
            </div>
          );
          case "summary": return (
            <div key={i} data-testid="block-summary" className={card}>
              <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">{b.title}</div>
              <div className="prose-target px-4 py-3 text-sm"><Markdown>{b.markdown}</Markdown></div>
            </div>
          );
          case "draft": return (
            <div key={i} data-testid="block-draft" className={card}>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <span className="text-sm font-semibold text-ink">{b.title}</span>
                <CopyBtn text={b.body} />
              </div>
              <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-ink-soft">{b.body}</div>
            </div>
          );
          case "code": return (
            <div key={i} data-testid="block-code" className={card}>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="text-xs text-muted">{b.title ? `${b.title} · ` : ""}{b.language}</span>
                <CopyBtn text={b.source} />
              </div>
              <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed text-ink-soft"><code>{b.source}</code></pre>
            </div>
          );
          case "calendar": return (
            <div key={i} data-testid="block-calendar" className={`${card} flex items-center gap-3 p-3`}>
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent/15 text-accent">
                <span className="text-[10px] uppercase">{new Date(b.start).toLocaleString(undefined, { month: "short" })}</span>
                <span className="text-lg font-semibold leading-none">{new Date(b.start).getDate()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{b.title}</div>
                <div className="truncate text-xs text-muted">{when(b.start)}{b.location ? ` · ${b.location}` : ""}</div>
              </div>
              <a href={calendarUrl(b)} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink-soft no-underline hover:bg-surface-3">Add</a>
            </div>
          );
          case "order": return (
            <div key={i} data-testid="block-order" className={card}>
              <div className="border-b border-line px-4 py-2.5"><div className={cap}>Order summary</div><div className="text-sm font-semibold text-ink">{b.merchant}</div></div>
              <ul className="divide-y divide-line px-4 text-sm">
                {b.items.map((it, j) => <li key={j} className="flex justify-between gap-3 py-2 text-ink-soft"><span>{it.name}</span><span className="shrink-0">{it.price}</span></li>)}
              </ul>
              <div className="flex justify-between border-t border-line px-4 py-2.5 text-sm font-semibold text-ink"><span>Total</span><span>{b.total}</span></div>
              <div className="border-t border-line px-4 py-3 text-xs text-muted">
                {b.comment ? `${b.comment} ` : ""}TARGET never pays for you: finish this on the merchant&apos;s own site.
              </div>
            </div>
          );
        }
      })}
    </div>
  );
}
