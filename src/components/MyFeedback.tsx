"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CATEGORY_LABEL, STATUS_LABEL, isCategory, isStatus } from "@/lib/feedback";

type Item = { id: string; message: string; category: string; page_path: string | null; status: string; created_at: string };

const STATUS_CLS: Record<string, string> = {
  new: "border-line-strong bg-surface-2 text-ink-soft", seen: "border-info/30 bg-info-subtle text-info", done: "border-ok/30 bg-ok-subtle text-ok",
};

/** The user's own feedback with its status (loading, error, empty and "Load more" pagination). */
export default function MyFeedback({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (p: number) => {
    const r = await fetch(`/api/feedback?page=${p}`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as { items: Item[]; more: boolean };
  }, []);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("loading");
    load(1).then((j) => { if (!live) return; setItems(j.items); setMore(j.more); setPage(1); setState("ready"); }, () => { if (live) setState("error"); });
    return () => { live = false; };
  }, [load, refreshKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try { const j = await load(page + 1); setItems((x) => [...x, ...j.items.filter((i) => !x.some((y) => y.id === i.id))]); setMore(j.more); setPage(page + 1); }
    catch { setState("error"); }
    finally { setLoadingMore(false); }
  };

  return (
    <section aria-labelledby="my-feedback" className="mt-8" data-testid="my-feedback">
      <h2 id="my-feedback" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-soft">Your feedback</h2>
      {state === "loading" && (
        <div aria-busy="true" data-testid="my-feedback-loading" className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-line bg-surface/60" />)}
        </div>
      )}
      {state === "error" && (
        <p role="alert" data-testid="my-feedback-error" className="rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2.5 text-sm text-danger">
          Couldn&apos;t load your feedback. <button type="button" className="underline" onClick={() => { setState("loading"); load(1).then((j) => { setItems(j.items); setMore(j.more); setPage(1); setState("ready"); }, () => setState("error")); }}>Retry</button>
        </p>
      )}
      {state === "ready" && items.length === 0 && (
        <p data-testid="my-feedback-empty" className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">Nothing sent yet. Your messages and their status show up here.</p>
      )}
      {state === "ready" && items.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface/80">
          {items.map((i) => (
            <li key={i.id} className="px-4 py-3" data-testid="my-feedback-item">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <span className="rounded-full border border-line px-2 py-0.5">{isCategory(i.category) ? CATEGORY_LABEL[i.category] : i.category}</span>
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_CLS[i.status] ?? STATUS_CLS.new}`}>{isStatus(i.status) ? STATUS_LABEL[i.status] : i.status}</span>
                <span>{new Date(i.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">{i.message}</p>
            </li>
          ))}
        </ul>
      )}
      {state === "ready" && more && (
        <div className="mt-3 flex justify-center"><Button size="sm" onClick={loadMore} disabled={loadingMore} data-testid="my-feedback-more">{loadingMore ? "Loading…" : "Load more"}</Button></div>
      )}
    </section>
  );
}
