"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { WORK_COOLDOWN_SEC, WORK_MIN_STAY_SEC, type WorkLink } from "@/lib/work";

type Pending = { viewId: string; linkId: string; startedAt: number; coins: number };
type Data = { links: WorkLink[]; signedIn: boolean; balance?: number; cooldowns?: Record<string, number>; error?: string };

const PENDING_KEY = "target-work-pending";
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The Work page: ad links, a coin balance, a 3-minute gap per link, and coins credited when the user comes back. */
export default function WorkBoard() {
  const [data, setData] = useState<Data | null>(null);
  const [until, setUntil] = useState<Record<string, number>>({}); // linkId -> epoch ms when it unlocks
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const claiming = useRef(false);

  useEffect(() => {
    fetch("/api/work").then((r) => r.json()).then((d: Data) => {
      setData(d);
      const t = Date.now();
      setUntil(Object.fromEntries(Object.entries(d.cooldowns ?? {}).filter(([, s]) => s > 0).map(([k, s]) => [k, t + s * 1000])));
    }).catch(() => setData({ links: [], signedIn: false, error: "Couldn't load work links." }));
    try { const p = localStorage.getItem(PENDING_KEY); if (p) setPending(JSON.parse(p)); } catch { /* ignore */ }
  }, []);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const savePending = (p: Pending | null) => {
    setPending(p);
    try { if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  };

  const claim = useCallback(async (p: Pending) => {
    if (claiming.current) return;
    const stayed = (Date.now() - p.startedAt) / 1000;
    if (stayed < WORK_MIN_STAY_SEC) {
      setNote({ kind: "info", text: `Stay on the ad ${Math.ceil(WORK_MIN_STAY_SEC - stayed)} more seconds, then come back for your coins.` });
      return;
    }
    claiming.current = true;
    try {
      const r = await fetch("/api/work/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewId: p.viewId }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setData((d) => (d ? { ...d, balance: j.balance } : d));
        setNote({ kind: "ok", text: `+${j.coins} coin${j.coins === 1 ? "" : "s"} added to your account.` });
        savePending(null);
      } else if (r.status === 425) {
        setNote({ kind: "info", text: j.error });
      } else {
        setNote({ kind: "error", text: j.error || "Couldn't add coins." });
        if (r.status !== 500) savePending(null);
      }
    } finally { claiming.current = false; }
  }, []);

  // Coming back to this tab after viewing the ad credits the coins.
  useEffect(() => {
    const back = () => { if (document.visibilityState === "visible" && pending) claim(pending); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [pending, claim]);

  async function open(link: WorkLink) {
    setNote(null);
    if (!data?.signedIn) { window.open(link.url, "_blank", "noopener"); return; }
    // Open the tab inside the click so popup blockers allow it, then point it at the ad once the view is recorded.
    const tab = window.open("", "_blank");
    setBusy(link.id);
    try {
      const r = await fetch("/api/work/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkId: link.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        tab?.close();
        if (r.status === 429 && j.retryAfter) setUntil((u) => ({ ...u, [link.id]: Date.now() + j.retryAfter * 1000 }));
        setNote({ kind: "error", text: j.error || "Couldn't open this link." });
        return;
      }
      if (tab) { tab.opener = null; tab.location.href = j.url; } else window.location.href = j.url;
      setUntil((u) => ({ ...u, [link.id]: Date.now() + WORK_COOLDOWN_SEC * 1000 }));
      savePending({ viewId: j.viewId, linkId: link.id, startedAt: Date.parse(j.startedAt) || Date.now(), coins: j.coins });
      setNote({ kind: "info", text: `Stay on the ad at least ${WORK_MIN_STAY_SEC} seconds, then come back here.` });
    } catch {
      tab?.close();
      setNote({ kind: "error", text: "Couldn't open this link. Check your internet." });
    } finally { setBusy(null); }
  }

  const noteCls = note?.kind === "ok" ? "border-accent/40 bg-accent/15 text-accent-strong" : note?.kind === "error" ? "border-danger/30 bg-danger-subtle text-danger" : "border-line-strong bg-surface/80 text-ink-soft";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16">
      <div className="text-center">
        <h1 className="font-display text-4xl tracking-tight text-white md:text-5xl">Work</h1>
        <p className="mt-2 text-sm text-stucco/70">Open an ad link, stay a few seconds, and earn coins.</p>
      </div>

      {data?.signedIn ? (
        <div data-testid="work-balance" className="mx-auto mt-6 flex max-w-xs items-center justify-between rounded-2xl border border-accent/30 bg-black/40 px-5 py-4 backdrop-blur-xl">
          <span className="text-sm text-stucco/70">Your coins</span>
          <span className="font-display text-3xl text-accent">{data.balance ?? 0}</span>
        </div>
      ) : data ? (
        <div data-testid="work-signin" className="mx-auto mt-6 max-w-md rounded-2xl border border-line-strong bg-black/40 px-5 py-4 text-center text-sm text-stucco/80 backdrop-blur-xl">
          Anyone can open the links. <a href="/login?next=/work" className="font-semibold text-accent underline">Log in</a> to earn coins in your account.
        </div>
      ) : null}

      <div data-testid="work-rules" className="mt-6 rounded-2xl border border-white/10 bg-black/35 p-5 text-sm leading-relaxed text-stucco/80 backdrop-blur-xl">
        <p className="font-semibold text-white">How it works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Tap a link. The ad opens in a new tab.</li>
          <li>Stay on the ad for at least {WORK_MIN_STAY_SEC} seconds.</li>
          <li>Come back to this page. Your coins are added automatically.</li>
        </ol>
        <p className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-accent-strong">
          There is no limit on how many ads you watch. But don&apos;t open the same link again and again: keep a gap of at least 3 minutes before opening the same link again.
        </p>
      </div>

      {pending && data?.signedIn && (
        <button type="button" data-testid="work-claim" onClick={() => claim(pending)}
          className="mt-4 w-full rounded-full bg-accent py-3 text-sm font-semibold text-accent-ink hover:bg-accent-strong">
          I&apos;m back, add my coins
        </button>
      )}
      {note && <p role="status" data-testid="work-note" className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noteCls}`}>{note.text}</p>}

      <div className="mt-6 space-y-3" data-testid="work-links">
        {data === null && <p className="text-center text-sm text-stucco/60">Loading links...</p>}
        {data && data.links.length === 0 && <p className="text-center text-sm text-stucco/60">{data.error ?? "No work links right now. Check back soon."}</p>}
        {data?.links.map((l, i) => {
          const left = Math.max(0, Math.ceil(((until[l.id] ?? 0) - now) / 1000));
          const locked = left > 0 && !!data.signedIn;
          return (
            <div key={l.id} data-testid="work-link" className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-sm font-semibold text-accent">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-white">{l.title}</p>
                <p className="text-xs text-stucco/60">{l.coins} coin{l.coins === 1 ? "" : "s"} per view</p>
              </div>
              <button type="button" onClick={() => open(l)} disabled={locked || busy === l.id} data-testid="work-open"
                className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong disabled:bg-white/10 disabled:text-stucco/60">
                {locked ? `Wait ${fmt(left)}` : busy === l.id ? "Opening..." : "Open"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
