"use client";
import { useEffect, useRef, useState } from "react";
import { VIDEO_CAPTION_MAX, VIDEO_MAX_SLIDES, VIDEO_MIN_SLIDES } from "@/lib/videoRenderShared";

const box = "w-full rounded-xl border border-line-strong bg-bg/80 px-3 py-2 text-sm text-ink placeholder:text-muted-soft outline-none focus:border-accent";
const card = "rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl";
const btn = "inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-accent-ink hover:brightness-110`;
const btnGhost = `${btn} border border-line-strong bg-surface-2 text-muted hover:text-ink`;

type Slide = { url: string; caption: string };
type RenderState =
  | { phase: "idle" }
  | { phase: "rendering"; jobId: string }
  | { phase: "done"; url: string; name: string }
  | { phase: "failed"; error: string };

const emptySlide = (): Slide => ({ url: "", caption: "" });
const POLL_MS = 3000;
const POLL_MAX = 100; // ~5 minutes: queue wait + the render itself (well under a minute on the worker)

/**
 * Video Maker (/app/social): 3–6 public image links + one caption each become a vertical
 * 1080x1920 slideshow video, rendered entirely inside TARGET on the compute worker (ffmpeg,
 * no outside video service) by POST /api/video/render, then polled until the private download
 * is ready. The video is silent — TARGET has no music bed yet. A finished render also stays in
 * the user's generated files, so closing the page after it is done loses nothing.
 */
export default function VideoMakerCard() {
  const [slides, setSlides] = useState<Slide[]>([emptySlide(), emptySlide(), emptySlide()]);
  const [state, setState] = useState<RenderState>({ phase: "idle" });
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => stopPolling, []);

  const setSlide = (i: number, patch: Partial<Slide>) =>
    setSlides((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const poll = (jobId: string) => {
    let tries = 0;
    stopPolling();
    timer.current = setInterval(() => {
      tries += 1;
      if (tries > POLL_MAX) {
        stopPolling();
        setState({ phase: "failed", error: "The render is taking longer than expected. It may still finish — your videos are kept in your generated files." });
        return;
      }
      void (async () => {
        try {
          const res = await fetch(`/api/video/render?id=${encodeURIComponent(jobId)}`);
          const j = (await res.json().catch(() => ({}))) as { status?: string; video?: { name: string; url: string }; error?: string };
          if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `Failed (HTTP ${res.status})`);
          if (j.status === "done" && j.video) { stopPolling(); setState({ phase: "done", url: j.video.url, name: j.video.name }); }
          else if (j.status === "failed") { stopPolling(); setState({ phase: "failed", error: j.error ?? "The render failed" }); }
        } catch (e) {
          stopPolling();
          setState({ phase: "failed", error: e instanceof Error ? e.message : "Network error while checking the render" });
        }
      })();
    }, POLL_MS);
  };

  const render = async () => {
    setNote(null);
    setState({ phase: "idle" });
    try {
      const res = await fetch("/api/video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides }),
      });
      const j = (await res.json().catch(() => ({}))) as { job_id?: string; error?: string };
      if (!res.ok || !j.job_id) {
        setNote(typeof j.error === "string" ? j.error : `Could not start the render (HTTP ${res.status})`);
        return;
      }
      setState({ phase: "rendering", jobId: j.job_id });
      poll(j.job_id);
    } catch { setNote("Network error. The render was not started."); }
  };

  const busy = state.phase === "rendering";
  return (
    <section className={card} aria-labelledby="vm-title" data-testid="video-maker">
      <div className="flex items-center justify-between gap-2">
        <h3 id="vm-title" className="text-sm font-semibold text-ink">Video Maker</h3>
        <span className="rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          Made in TARGET · no outside service
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Turn {VIDEO_MIN_SLIDES}–{VIDEO_MAX_SLIDES} image links into a vertical video (1080x1920): each image
        slowly zooms for about 3 seconds with your caption on it, joined by gentle fades. Rendering happens
        on TARGET&apos;s own worker and usually takes under a minute. The video is silent for now.
      </p>

      <div className="mt-3 space-y-3">
        {slides.map((s, i) => (
          <div key={i} className="rounded-xl border border-line bg-bg/40 p-3" data-testid={`vm-slide-${i}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">Image {i + 1}</span>
              {slides.length > VIDEO_MIN_SLIDES && (
                <button type="button" className="text-xs text-muted hover:text-danger" disabled={busy}
                  onClick={() => setSlides((cur) => cur.filter((_, j) => j !== i))} data-testid={`vm-remove-${i}`}>
                  Remove
                </button>
              )}
            </div>
            <label className="sr-only" htmlFor={`vm-url-${i}`}>Image {i + 1} link</label>
            <input id={`vm-url-${i}`} type="url" value={s.url} disabled={busy}
              onChange={(e) => setSlide(i, { url: e.target.value })}
              className={`${box} mt-2`} placeholder="https://… image link (jpg or png)" data-testid={`vm-url-${i}`} />
            <label className="sr-only" htmlFor={`vm-caption-${i}`}>Image {i + 1} caption</label>
            <input id={`vm-caption-${i}`} type="text" value={s.caption} maxLength={VIDEO_CAPTION_MAX} disabled={busy}
              onChange={(e) => setSlide(i, { caption: e.target.value })}
              className={`${box} mt-2`} placeholder="Caption shown on this image" data-testid={`vm-caption-${i}`} />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {slides.length < VIDEO_MAX_SLIDES && (
          <button type="button" className={btnGhost} disabled={busy}
            onClick={() => setSlides((cur) => [...cur, emptySlide()])} data-testid="vm-add">
            Add image
          </button>
        )}
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void render()} data-testid="vm-render">
          {busy ? "Rendering…" : "Render video"}
        </button>
        {note && <span role="status" className="text-xs text-danger">{note}</span>}
        {state.phase === "rendering" && (
          <span role="status" className="text-xs text-muted">Rendering on TARGET&apos;s worker — keep this page open…</span>
        )}
        {state.phase === "failed" && <span role="status" className="text-xs text-danger">{state.error}</span>}
      </div>

      {state.phase === "done" && (
        <div className="mt-4" data-testid="vm-result">
          <video controls src={state.url} className="mx-auto max-h-[480px] rounded-xl border border-line" />
          <div className="mt-2 text-center">
            <a href={state.url} download={state.name} className="text-sm font-medium text-accent hover:underline">
              Download {state.name}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
