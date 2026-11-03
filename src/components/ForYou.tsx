"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/Button";

export type ForYouItem = { id: string; kind: string; title: string; detail: string; prompt: string; due_at: string | null };

const ICON: Record<string, string> = {
  bill: "M3 6h18v12H3zM3 10h18", travel: "M2 16l20-6-20-6 4 6zM6 10h8", deadline: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  event: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4", delivery: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z", other: "M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z",
};

/** "For you": offers TARGET found in the user's recent mail and calendar. Do it opens chat with the request ready. */
export default function ForYou({ initial, compact = false }: { initial: ForYouItem[]; compact?: boolean }) {
  const [items, setItems] = useState(initial);
  async function set(id: string, status: "dismissed" | "done") {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await fetch(`/api/suggestions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => undefined);
  }
  if (!items.length) return null;
  if (compact) return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface/80" data-testid="for-you">
      {items.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-2.5 pl-3.5 pr-2">
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[s.kind] ?? ICON.other} /></svg>
          <p className="min-w-0 flex-1 truncate text-sm text-ink" title={s.detail || s.title}>{s.title}</p>
          <Link className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink hover:bg-accent-strong" href={`/app?q=${encodeURIComponent(s.prompt)}&send=1`} onClick={() => { void set(s.id, "done"); }}>Do it</Link>
          <button onClick={() => set(s.id, "dismissed")} aria-label={`Dismiss “${s.title}”`} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-soft hover:bg-surface-2 hover:text-ink">×</button>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-3" data-testid="for-you">
      {items.map((s) => (
        <article key={s.id} className="flex gap-3 rounded-xl border border-accent/25 bg-surface p-4 text-sm">
          <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[s.kind] ?? ICON.other} /></svg>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{s.title}</p>
            {s.detail && <p className="mt-0.5 text-xs text-muted">{s.detail}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className={buttonClass("primary", "sm")} href={`/app?q=${encodeURIComponent(s.prompt)}&send=1`} onClick={() => { void set(s.id, "done"); }}>Do it</Link>
              <Button size="sm" variant="ghost" onClick={() => set(s.id, "dismissed")}>Not now</Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
