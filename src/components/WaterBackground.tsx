"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen moving-water background, done the way venice.ai does it: a real
 * footage loop of dark teal night water (public/water-loop.mp4, a free Pexels
 * clip colour-graded and cross-faded into a seamless loop) over a still poster
 * frame (public/water-poster.webp) that is preloaded so something shows instantly.
 * The video fades in over 1.5s once it is playing. Bottom-right pause/play toggle;
 * starts paused for users who prefer reduced motion.
 */
export default function WaterBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof v.play !== "function") return;
    if (playing) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else {
      v.pause();
    }
  }, [playing]);

  return (
    <>
      {/* Poster: a still frame of the footage, preloaded so it shows instantly */}
      <div
        aria-hidden="true"
        data-testid="water-poster"
        className="fixed inset-0 -z-30 bg-[#04090b] bg-cover bg-center"
        style={{ backgroundImage: "url(/water-poster.webp)" }}
      />
      <video
        ref={videoRef}
        aria-hidden="true"
        data-testid="water-video"
        className="fixed left-0 top-0 -z-20 h-full w-full object-cover transition-opacity duration-[1500ms] ease-in-out"
        style={{ opacity: ready ? 1 : 0 }}
        src="/water-loop.mp4"
        poster="/water-poster.webp"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture

        onPlaying={() => setReady(true)}
      />
      {/* far water sinks into darkness, plus a soft vignette */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/10 to-black/30" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)" }}
      />
      <button
        type="button"
        data-testid="water-toggle"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause water motion" : "Play water motion"}
        aria-pressed={!playing}
        className="fixed bottom-6 right-6 z-40 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white md:bottom-14 md:right-10"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3 w-3 translate-x-[1px]" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
        )}
      </button>
    </>
  );
}
