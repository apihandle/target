"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type PageItem = { id: string; slug: string; title: string; published: boolean; created_at: string };
type FileItem = { id: string; name: string; mime: string; size_bytes: number; created_at: string };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const card = "flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur";

export function PagesList() {
  const [items, setItems] = useState<PageItem[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => { const r = await fetch("/api/pages", { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) setError(j.error ?? "Couldn't load"); setItems(j.pages ?? []); };
  useEffect(() => { load(); }, []);
  async function act(id: string, how: "hide" | "show" | "delete") {
    if (how === "delete" && !confirm("Delete this Page? The link stops working.")) return;
    const r = how === "delete" ? await fetch(`/api/pages/${id}`, { method: "DELETE" }) : await fetch(`/api/pages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ published: how === "show" }) });
    if (!r.ok) setError("Couldn't update. Try again."); else load();
  }
  if (!items) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-3" data-testid="pages-list">
      {error && <p className="text-sm text-danger">{error}</p>}
      {!items.length && <p className="rounded-2xl border border-line bg-surface/60 p-5 text-sm text-muted">No Pages yet. Ask TARGET: &quot;Goa trip ka itinerary Page bana do&quot;.</p>}
      {items.map((p) => (
        <article key={p.id} className={card}>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium"><span className="truncate">{p.title}</span><Badge tone={p.published ? "accent" : "neutral"}>{p.published ? "Public" : "Hidden"}</Badge></p>
            <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-accent-strong underline">gettarget.vercel.app/p/{p.slug}</a>
            <p className="mt-1 text-xs text-muted-soft">{day(p.created_at)}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(`https://gettarget.vercel.app/p/${p.slug}`)}>Copy link</Button>
            <Button size="sm" onClick={() => act(p.id, p.published ? "hide" : "show")}>{p.published ? "Hide" : "Show"}</Button>
            <Button size="sm" variant="danger" onClick={() => act(p.id, "delete")}>Delete</Button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function FilesList() {
  const [items, setItems] = useState<FileItem[] | null>(null);
  const load = async () => { const r = await fetch("/api/files", { cache: "no-store" }); const j = await r.json().catch(() => ({})); setItems(j.files ?? []); };
  useEffect(() => { load(); }, []);
  async function del(id: string) { if (!confirm("Delete this file?")) return; await fetch(`/api/files/${id}`, { method: "DELETE" }); load(); }
  if (!items) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-3" data-testid="files-list">
      {!items.length && <p className="rounded-2xl border border-line bg-surface/60 p-5 text-sm text-muted">No files yet. Ask TARGET: &quot;Meri resume ki PDF bana do&quot;.</p>}
      {items.map((f) => (
        <article key={f.id} className={card}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{f.name}</p>
            <p className="mt-1 text-xs text-muted-soft">{Math.ceil(f.size_bytes / 1024)} KB · {day(f.created_at)}</p>
          </div>
          <div className="flex gap-2">
            <a href={`/api/files/${f.id}`} className="rounded-lg border border-accent/60 px-3 py-1.5 text-xs font-medium text-accent-strong">Download</a>
            <Button size="sm" variant="danger" onClick={() => del(f.id)}>Delete</Button>
          </div>
        </article>
      ))}
    </div>
  );
}
