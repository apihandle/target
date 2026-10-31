"use client";
import { useEffect, useState } from "react";

type Link = { id: string; title: string; url: string; coins: number; active: boolean };

/** Owner-only: add, pause or delete the ad links shown on /work. */
export default function WorkLinksManager() {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [coins, setCoins] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/work/links").then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (r.ok) setLinks(j.links); else { setLinks([]); setError(j.error || "Couldn't load links."); }
  });
  useEffect(() => { load(); }, []);

  async function call(method: string, body: object) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/work/links", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || "Something went wrong."); return false; }
      await load();
      return true;
    } finally { setBusy(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("POST", { title: title.trim(), url: url.trim(), coins: Number(coins) })) { setTitle(""); setUrl(""); setCoins("1"); }
  }

  const input = "w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/60";
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-3 rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="work-link-form">
        <p className="text-[15px] font-medium text-ink">Add an ad link</p>
        <input className={input} placeholder="Title, e.g. Ad 1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required aria-label="Title" />
        <input className={input} placeholder="https://... (your Monetag Direct Link)" value={url} onChange={(e) => setUrl(e.target.value)} required aria-label="Link" inputMode="url" />
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted" htmlFor="wl-coins">Coins per view</label>
          <input id="wl-coins" className={`${input} w-24`} type="number" min={1} max={1000} value={coins} onChange={(e) => setCoins(e.target.value)} />
          <button disabled={busy} className="ml-auto rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50">Add</button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="space-y-2" data-testid="work-link-list">
        {links === null && <p className="text-sm text-muted">Loading...</p>}
        {links?.length === 0 && !error && <p className="text-sm text-muted">No links yet. Add your first one above.</p>}
        {links?.map((l) => (
          <div key={l.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/80 p-3 backdrop-blur-xl">
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${l.active ? "text-ink" : "text-muted line-through"}`}>{l.title} <span className="text-muted">· {l.coins} coins</span></p>
              <p className="truncate text-xs text-muted-soft">{l.url}</p>
            </div>
            <button disabled={busy} onClick={() => call("PATCH", { id: l.id, active: !l.active })} className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink-soft hover:text-ink">{l.active ? "Pause" : "Resume"}</button>
            <button disabled={busy} onClick={() => { if (window.confirm(`Delete "${l.title}"?`)) call("DELETE", { id: l.id }); }} className="rounded-full border border-danger/40 px-3 py-1.5 text-xs text-danger">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
