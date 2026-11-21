"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Blog picker for the Blogger card on /app/connectors. The Blogger connection itself is made with the
 * card's Connect button (standard connector OAuth); this panel only answers "which of my blogs do
 * social posts go to?" — the choice is a per-user setting saved through /api/social/blogger, with the
 * blog name/URL always taken from the Blogger API listing server-side, never from this client.
 */
type Blog = { id: string; name: string; url: string | null };
type Status = { connected: boolean; accountLabel: string; blog: { blogId: string; blogName: string; blogUrl: string | null } | null };
type Reply = { status: Status; blogs: Blog[]; error?: string };

export default function BloggerBlogPicker() {
  const [status, setStatus] = useState<Status | null>(null);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/social/blogger");
      const j = (await r.json().catch(() => null)) as Reply | null;
      if (!r.ok || !j) { setError("Couldn't load your blogs. Try again."); return; }
      setStatus(j.status);
      setBlogs(j.blogs ?? []);
      setPick(j.status.blog?.blogId ?? "");
      if (j.error) setError(j.error);
    } catch { setError("Couldn't load your blogs. Try again."); }
    finally { setLoaded(true); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; state is set from the async fetch result
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!pick) { setError("Pick a blog first."); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/social/blogger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blogId: pick }) });
      const j = (await r.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
      if (!r.ok) { setError(j.error ?? "Couldn't save the blog choice."); return; }
      if (j.status) { setStatus(j.status); setPick(j.status.blog?.blogId ?? ""); }
    } catch { setError("Network error. Nothing was saved."); }
    finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/social/blogger", { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
      if (!r.ok) { setError(j.error ?? "Couldn't clear the blog choice."); return; }
      if (j.status) { setStatus(j.status); setPick(""); }
    } catch { setError("Network error. Nothing changed."); }
    finally { setBusy(false); }
  }

  if (!loaded) return null;
  if (!status?.connected) return null;

  const chosen = status.blog;
  return (
    <section data-testid="blogger-picker" aria-label="Blogger blog choice"
      className="mt-4 rounded-xl2 border border-line bg-surface px-4 py-3 shadow-card">
      <h2 className="font-medium text-ink">Which blog should social posts go to?</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Connected as {status.accountLabel || "your Google account"}. The social composer posts to the blog you pick here — only yours, never anyone else&apos;s.
      </p>
      {chosen && (
        <p data-testid="blogger-current" className="mt-2 text-sm text-ink">
          Posting to: <span className="font-medium">{chosen.blogName}</span>
          {chosen.blogUrl && <span className="text-ink-soft"> · {chosen.blogUrl}</span>}
        </p>
      )}
      {blogs.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="blogger-blog-select" className="sr-only">Choose a blog</label>
          <select id="blogger-blog-select" data-testid="blogger-blog-select" value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent">
            <option value="">Choose a blog…</option>
            {blogs.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.url ? ` — ${b.url}` : ""}</option>
            ))}
          </select>
          <Button size="sm" variant="primary" data-testid="blogger-blog-save" disabled={busy || !pick || pick === chosen?.blogId} onClick={() => void save()}>
            {busy ? "…" : "Save"}
          </Button>
          {chosen && (
            <Button size="sm" variant="ghost" data-testid="blogger-blog-clear" disabled={busy} onClick={() => void clear()}>
              Clear choice
            </Button>
          )}
        </div>
      ) : (
        !error && <p className="mt-2 text-sm text-ink-soft">No blogs were found on this Blogger account.</p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
