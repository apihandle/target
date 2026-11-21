"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Page picker for the Facebook / Instagram cards on /app/connectors. The Meta connection itself is
 * made with the cards' Connect button (Facebook Login, /api/connectors/meta/start); this panel only
 * answers "which of my Pages do social posts go to?" — the choice is stored server-side through
 * /api/social/meta, with the Page name, its access token and the linked Instagram account always
 * taken from the Graph API listing server-side, never from this client (the token is never sent to
 * the browser at all). The Instagram card follows automatically: it is the professional account
 * linked to the picked Page.
 */
type IgRef = { id: string; username: string };
type Page = { id: string; name: string; instagram: IgRef | null };
type Status = {
  connected: boolean;
  accountLabel: string;
  page: { id: string; name: string } | null;
  instagram: IgRef | null;
};
type Reply = { status: Status; pages: Page[]; error?: string };

export default function MetaPagePicker() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/social/meta");
      const j = (await r.json().catch(() => null)) as Reply | null;
      if (!r.ok || !j) { setError("Couldn't load your Pages. Try again."); return; }
      setStatus(j.status);
      setPages(j.pages ?? []);
      setPick(j.status.page?.id ?? "");
      if (j.error) setError(j.error);
    } catch { setError("Couldn't load your Pages. Try again."); }
    finally { setLoaded(true); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; state is set from the async fetch result
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!pick) { setError("Pick a Page first."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/social/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: pick }) });
      const j = (await r.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
      if (!r.ok) { setError(j.error ?? "Couldn't save the Page choice."); return; }
      if (j.status) { setStatus(j.status); setPick(j.status.page?.id ?? ""); }
    } catch { setError("Network error. Nothing was saved."); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/social/meta", { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
      if (!r.ok) { setError(j.error ?? "Couldn't clear the Page choice."); return; }
      if (j.status) { setStatus(j.status); setPick(""); }
    } catch { setError("Network error. Nothing changed."); }
    finally { setBusy(false); }
  }

  if (!loaded) return null;
  if (!status?.connected) return null;

  const chosen = status.page;
  return (
    <section data-testid="meta-picker" aria-label="Facebook Page choice"
      className="mt-4 rounded-xl2 border border-line bg-surface px-4 py-3 shadow-card">
      <h2 className="font-medium text-ink">Which Facebook Page should social posts go to?</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Connected as {status.accountLabel || "your Facebook account"}. The social composer posts to the Page you pick
        here — only yours, never anyone else&apos;s — and to the Instagram account linked to that Page.
      </p>
      {chosen && (
        <p data-testid="meta-current" className="mt-2 text-sm text-ink">
          Posting to: <span className="font-medium">{chosen.name}</span>
          {status.instagram
            ? <span className="text-ink-soft"> · Instagram @{status.instagram.username || status.instagram.id}</span>
            : <span className="text-ink-soft"> · No Instagram linked to this Page</span>}
        </p>
      )}
      {pages.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="meta-page-select" className="sr-only">Choose a Page</label>
          <select id="meta-page-select" data-testid="meta-page-select" value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent">
            <option value="">Choose a Page…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.instagram ? ` — Instagram @${p.instagram.username || p.instagram.id}` : " — no Instagram linked"}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" data-testid="meta-page-save" disabled={busy || !pick || pick === chosen?.id} onClick={() => void save()}>
            {busy ? "…" : "Save"}
          </Button>
          {chosen && (
            <Button size="sm" variant="ghost" data-testid="meta-page-clear" disabled={busy} onClick={() => void clear()}>
              Clear choice
            </Button>
          )}
        </div>
      ) : (
        !error && <p className="mt-2 text-sm text-ink-soft">No Pages were found on this Facebook account. Create a Page on Facebook first, then reconnect.</p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
