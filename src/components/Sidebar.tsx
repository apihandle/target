"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ConvItem = { id: string; title: string; pinned?: boolean };
export type Section = "home" | "chat" | "projects" | "panels" | "scheduled" | "activity" | "connectors" | "settings" | "memory";
type Hit = { id: string; title: string; pinned: boolean; snippet: string | null };

const NAV: { id: Section; href: string; label: string; icon: string }[] = [
  { id: "home", href: "/app/home", label: "Home", icon: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { id: "chat", href: "/app", label: "Chat", icon: "M4 5h16v11H8l-4 4z" },
  { id: "projects", href: "/app/projects", label: "Projects", icon: "M3 6h7l2 2h9v11H3z" },
  { id: "panels", href: "/app/panels", label: "Panels", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { id: "scheduled", href: "/app/scheduled", label: "Scheduled", icon: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
  { id: "connectors", href: "/app/connectors", label: "Connectors", icon: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" },
  { id: "activity", href: "/app/activity", label: "Activity", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { id: "settings", href: "/app/settings", label: "Settings", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-6l-.5 2.5-1.5 1L5 7l-2 4 2 1v0l-2 1 2 4 2-.5 1.5 1L9 20h6l.5-2.5 1.5-1 2 .5 2-4z" },
];

function Icon({ d }: { d: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"><path d={d} /></svg>;
}

export function Logo({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`grid place-items-center rounded-full bg-accent font-black text-accent-ink ${size === "md" ? "h-9 w-9" : "h-7 w-7 text-sm"}`}>◎</span>
      <span className={`font-extrabold tracking-[0.2em] ${size === "md" ? "text-xl" : "text-sm"}`}>TARGET</span>
    </span>
  );
}

export default function Sidebar({ conversations, activeId, email, section = "chat", pendingApprovals = 0 }: { conversations: ConvItem[]; activeId?: string; email: string; section?: Section; pendingApprovals?: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const current = section === "memory" ? "settings" : section;
  const close = () => setOpen(false);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinnedOverride, setPinnedOverride] = useState<Record<string, boolean>>({});
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); setSearching(false); return; }
    const n = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversations/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (n === seq.current) setHits(r.ok ? j.results ?? [] : []);
      } catch { if (n === seq.current) setHits([]); }
      finally { if (n === seq.current) setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function togglePin(c: ConvItem) {
    const next = !(pinnedOverride[c.id] ?? c.pinned);
    setPinError(null);
    setPinnedOverride((o) => ({ ...o, [c.id]: next }));
    try {
      const r = await fetch(`/api/conversations/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: next }) });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      setPinnedOverride((o) => ({ ...o, [c.id]: !next }));
      setPinError("Couldn't update the pin. Try again.");
    }
  }
  const list = conversations.map((c) => ({ ...c, pinned: pinnedOverride[c.id] ?? !!c.pinned }));
  const pinned = list.filter((c) => c.pinned);
  const recent = list.filter((c) => !c.pinned);
  const row = (c: ConvItem) => (
    <div key={c.id} className="group flex items-center rounded-lg hover:bg-surface" data-testid="conv-item">
      <Link href={`/app?c=${c.id}`} onClick={close} aria-current={c.id === activeId ? "page" : undefined}
        className={`block min-w-0 flex-1 truncate rounded-lg px-3 py-1.5 text-sm ${c.id === activeId ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
        {c.title}
      </Link>
      <button type="button" data-testid="pin-btn" onClick={() => togglePin(c)} aria-pressed={!!c.pinned} aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`}
        className={`mr-1 shrink-0 rounded px-1.5 py-1 text-xs focus:opacity-100 ${c.pinned ? "text-accent-strong" : "text-muted-soft opacity-0 hover:text-ink group-hover:opacity-100"}`}>
        {c.pinned ? "★" : "☆"}
      </button>
    </div>
  );

  return (
    <>
      <button data-testid="menu-btn" aria-label="Open navigation" aria-expanded={open} aria-controls="app-nav" onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface text-ink md:hidden">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={close} />}
      <aside id="app-nav" aria-label="Workspace" className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-[#0f1014] p-3 transition-transform md:static md:w-64 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-2 py-1.5">
          <Link href="/app/home" onClick={close} aria-label="TARGET home"><Logo /></Link>
          <button onClick={close} aria-label="Close navigation" className="rounded-full px-2 py-1 text-muted hover:text-ink md:hidden">✕</button>
        </div>
        <Link href="/app" data-testid="new-chat" onClick={close}
          className="mt-4 flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-accent-ink hover:bg-accent-strong">
          <span aria-hidden>＋</span> New chat
        </Link>
        <nav aria-label="Main" className="mt-4 space-y-0.5">
          {NAV.map((n) => {
            const active = current === n.id;
            return (
              <Link key={n.id} href={n.href} onClick={close} data-testid={`nav-${n.id}`} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface hover:text-ink"}`}>
                <Icon d={n.icon} /><span className="flex-1">{n.label}</span>
                {n.id === "activity" && pendingApprovals > 0 && (
                  <span data-testid="pending-count" className="rounded-full bg-warn px-1.5 text-[11px] font-semibold text-[#1f1703]" aria-label={`${pendingApprovals} waiting for approval`}>{pendingApprovals}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-5 px-1">
          <label htmlFor="chat-search" className="sr-only">Search chats</label>
          <input id="chat-search" data-testid="chat-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
            placeholder="Search chats…" className="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-muted-soft focus:border-accent" />
        </div>
        <nav aria-label={hits ? "Search results" : "Recent chats"} className="mt-2 flex-1 space-y-0.5 overflow-y-auto" data-testid="conv-list">
          {hits ? (
            <>
              <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-soft">{searching ? "Searching…" : `Results (${hits.length})`}</h2>
              {!searching && hits.length === 0 && <p className="px-3 py-1 text-xs text-muted-soft">No chats match “{query.trim()}”.</p>}
              {hits.map((h) => (
                <Link key={h.id} href={`/app?c=${h.id}`} onClick={close} data-testid="search-hit" className="block rounded-lg px-3 py-1.5 text-muted hover:bg-surface hover:text-ink">
                  <span className="block truncate text-sm">{h.pinned ? "★ " : ""}{h.title}</span>
                  {h.snippet && <span className="block truncate text-[11px] text-muted-soft">{h.snippet}</span>}
                </Link>
              ))}
            </>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-soft">Pinned</h2>
                  <div data-testid="pinned-list" className="space-y-0.5">{pinned.map(row)}</div>
                </>
              )}
              <h2 className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-soft ${pinned.length ? "pt-3" : ""}`}>Recent chats</h2>
              {conversations.length === 0 && <p className="px-3 py-1 text-xs text-muted-soft">No chats yet. Start one above.</p>}
              {recent.map(row)}
            </>
          )}
          {pinError && <p role="alert" className="px-3 py-1 text-xs text-danger">{pinError}</p>}
        </nav>
        <div className="mt-2 border-t border-line px-1 pt-3">
          <p data-testid="user-email" className="truncate px-2 text-xs text-muted">{email}</p>
          <form action="/auth/signout" method="post">
            <button data-testid="signout" className="mt-2 h-9 w-full rounded-full border border-line-strong text-sm text-ink-soft hover:bg-surface-2">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
