"use client";
import Link from "next/link";
import { useState } from "react";

export type ConvItem = { id: string; title: string };

export default function Sidebar({ conversations, activeId, email, section = "chat" }: { conversations: ConvItem[]; activeId?: string; email: string; section?: "chat" | "memory" | "projects" | "home" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="menu-btn" onClick={() => setOpen(true)} className="fixed left-3 top-3 z-30 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-sm md:hidden">☰</button>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-[#0b0b0e] p-4 transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-600 text-sm font-black">◎</span>
          <span className="font-extrabold tracking-widest">TARGET</span>
        </div>
        <Link href="/app" data-testid="new-chat" onClick={() => setOpen(false)} className="mt-6 rounded-full bg-white py-2 text-center text-sm font-semibold text-black">+ New chat</Link>
        <Link href="/app/home" data-testid="nav-home" onClick={() => setOpen(false)}
          className={`mt-3 rounded-xl px-3 py-2 text-sm ${section === "home" ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>🏠 Home</Link>
        <Link href="/app/memory" data-testid="nav-memory" onClick={() => setOpen(false)}
          className={`rounded-xl px-3 py-2 text-sm ${section === "memory" ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>🧠 Memory</Link>
        <Link href="/app/projects" data-testid="nav-projects" onClick={() => setOpen(false)}
          className={`rounded-xl px-3 py-2 text-sm ${section === "projects" ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>📁 Projects</Link>
        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto" data-testid="conv-list">
          {conversations.length === 0 && <p className="px-2 text-xs text-white/40">No chats yet</p>}
          {conversations.map((c) => (
            <Link key={c.id} href={`/app?c=${c.id}`} onClick={() => setOpen(false)}
              className={`block truncate rounded-xl px-3 py-2 text-sm ${c.id === activeId ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"}`}>
              {c.title}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-3">
          <p data-testid="user-email" className="truncate text-xs text-white/50">{email}</p>
          <form action="/auth/signout" method="post">
            <button data-testid="signout" className="mt-2 w-full rounded-full border border-white/20 py-2 text-sm hover:bg-white/10">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
