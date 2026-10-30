"use client";
import Link from "next/link";
import { useState } from "react";
import { quickActionHref, type QuickAction } from "@/lib/settings";

/** Shortcut chips. Each one opens a chat (or the new-project form) with its intent pre-filled; nothing runs on click. */
export default function QuickActions({ actions, hidden: initialHidden }: { actions: QuickAction[]; hidden: string[] }) {
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const visible = actions.filter((a) => !hidden.includes(a.id));

  async function dismiss(id: string) {
    const next = [...hidden, id].slice(-20);
    setHidden(next);
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden_quick_actions: next }) }).catch(() => null);
    if (!r || !r.ok) setHidden(hidden);
  }

  if (!visible.length) return <p className="text-xs text-muted">All quick actions are hidden. <Link href="/app/settings/quick-actions" className="underline">Manage them in Settings</Link>.</p>;
  return (
    <ul data-testid="quick-actions" className="flex flex-wrap gap-2">
      {visible.map((a) => (
        <li key={a.id} className="group inline-flex items-center rounded-full border border-line-strong bg-surface">
          <Link href={quickActionHref(a)} data-testid="quick-action" className="py-2 pl-4 pr-2 text-sm text-ink-soft hover:text-ink">{a.label}</Link>
          <button onClick={() => dismiss(a.id)} aria-label={`Hide “${a.label}”`} data-testid="quick-action-hide" className="mr-1 grid h-7 w-7 place-items-center rounded-full text-muted-soft hover:bg-surface-2 hover:text-ink">×</button>
        </li>
      ))}
    </ul>
  );
}
