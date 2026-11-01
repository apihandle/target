"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type Help = { reason: string; screenshot: string; w: number; h: number; at: string };

/**
 * The page TARGET's browser is stuck on (usually an "I'm not a robot" check). Tap on the picture and the
 * worker taps the same spot on the real page; type and keys work the same way. Done hands control back.
 */
export default function BrowserHelp({ id, onFinished }: { id: string; onFinished?: () => void }) {
  const [help, setHelp] = useState<Help | null>(null);
  const [gone, setGone] = useState(false);
  const [text, setText] = useState("");
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const r = await fetch(`/api/browser-jobs/${id}/help`, { cache: "no-store" }).catch(() => null);
    if (!r || !alive.current) return;
    const j = await r.json().catch(() => ({}));
    if (j.help) { setHelp(j.help); setGone(false); } else if (r.ok) setGone(true);
  }, [id]);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, 2000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  async function send(input: Record<string, unknown>) {
    setSending(true); setError("");
    const r = await fetch(`/api/browser-jobs/${id}/help`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
    setSending(false);
    if (!r?.ok) { const j = await r?.json().catch(() => ({})); setError(j?.error ?? "Couldn't send that. Check your internet."); return false; }
    if (input.t === "done") { setGone(true); onFinished?.(); }
    return true;
  }

  function tap(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    setMark({ x, y });
    setTimeout(() => setMark(null), 900);
    send({ t: "tap", x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  }

  if (gone) return <p className="mt-3 text-xs text-muted">Thanks, TARGET is carrying on.</p>;
  if (!help) return <p className="mt-3 text-xs text-muted">Loading the page…</p>;
  return (
    <div className="mt-3 space-y-3" data-testid="browser-help">
      <p className="text-sm text-ink">{help.reason}. Tap on the picture exactly where you would tap on the site. Press Done when it lets you through.</p>
      <button type="button" onClick={tap} aria-label="Tap on the page" className="relative block w-full overflow-hidden rounded-xl border border-accent/50 bg-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/jpeg;base64,${help.screenshot}`} alt="The page TARGET's browser is on" className="block h-auto w-full select-none" draggable={false} />
        {mark && <span aria-hidden="true" className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/30" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }} />}
      </button>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && (await send({ t: "type", text }))) setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Type letters from the picture" aria-label="Text to type on the page"
          className="min-w-0 flex-1 rounded-full border border-line bg-bg/70 px-4 py-2 text-sm text-ink outline-none focus:border-accent" />
        <Button size="sm" type="submit" disabled={sending || !text.trim()}>Type</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => send({ t: "key", key: "Enter" })} disabled={sending}>Enter</Button>
        <Button size="sm" onClick={() => send({ t: "key", key: "Backspace" })} disabled={sending}>Backspace</Button>
        <Button size="sm" variant="approve" onClick={() => send({ t: "done" })} disabled={sending} data-testid="browser-help-done">Done, carry on</Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-[11px] text-muted-soft">Updated {new Date(help.at).toLocaleTimeString()}. TARGET waits up to 5 minutes.</p>
    </div>
  );
}
