"use client";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/activity";

type Share = { id: string; created_at: string };

/** Owner-only: create a read-only public link to this chat, copy it, and revoke links at any time. */
export default function ShareButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey); window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [open]);

  async function load() {
    try {
      const r = await fetch(`/api/conversations/${conversationId}/shares`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load links");
      setShares(j.shares ?? []);
    } catch (e) { setShares([]); setError(e instanceof Error ? e.message : "Could not load links"); }
  }
  function toggle() { const n = !open; setOpen(n); setError(null); setCopied(false); if (n) load(); }

  async function create() {
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/shares`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not create a link");
      setLink(`${window.location.origin}${j.path}`);
      setShares((s) => [j.share, ...(s ?? [])]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create a link"); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setError(null);
    const r = await fetch(`/api/shares/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { setError("Could not revoke the link"); return; }
    setShares((s) => (s ?? []).filter((x) => x.id !== id));
    setLink(null);
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div ref={box} className="relative">
      <button type="button" data-testid="share-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-ink-soft hover:bg-surface-2">Share</button>
      {open && (
        <div role="dialog" aria-label="Share this chat" data-testid="share-dialog"
          className="absolute right-0 top-9 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line-strong bg-surface p-3 text-left shadow-card">
          <p className="text-sm font-medium text-ink">Share a read-only link</p>
          <p className="mt-1 text-xs text-muted">Anyone with the link can read this chat (messages and file names, not the files). They can&apos;t reply or see anything else. Revoke it any time.</p>
          {link ? (
            <div className="mt-3 space-y-2">
              <input readOnly value={link} aria-label="Share link" data-testid="share-link" onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-line-strong bg-bg px-2 py-1.5 text-xs text-ink" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-soft">Copy it now: for security it can&apos;t be shown again.</span>
                <button type="button" onClick={copy} className="h-8 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink">{copied ? "Copied ✓" : "Copy"}</button>
              </div>
            </div>
          ) : (
            <button type="button" data-testid="share-create" disabled={busy} onClick={create} className="mt-3 h-8 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-40">
              {busy ? "Creating…" : "Create link"}
            </button>
          )}
          {!!shares?.length && (
            <div className="mt-4 border-t border-line pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-soft">Active links</p>
              <ul className="mt-1 space-y-1">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-xs text-ink-soft">
                    <span>Created {timeAgo(s.created_at)}</span>
                    <button type="button" data-testid="share-revoke" onClick={() => revoke(s.id)} className="rounded-full px-2 py-0.5 text-danger hover:bg-danger-subtle">Revoke</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
