"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* Minimal typing for the Web Speech API (not in TS's DOM lib). */
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionCtor = new () => Recognition;

export function getRecognition(w: unknown = typeof window !== "undefined" ? window : undefined): RecognitionCtor | null {
  const win = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
}

/**
 * Mic button using the browser's own Web Speech API (no paid service). Renders nothing when the
 * browser doesn't support it. Final transcripts are appended to the composer via onText.
 */
export default function VoiceButton({ onText, disabled, fallback = null }: { onText: (text: string) => void; disabled?: boolean; fallback?: ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser-only API after mount so server and client markup match
  useEffect(() => { setSupported(!!getRecognition()); return () => rec.current?.abort(); }, []);
  if (!supported) return <>{fallback}</>;

  function toggle() {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = getRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-IN";
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e) => setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone permission was denied." : e.error === "no-speech" ? "Didn't catch that. Try again." : "Voice input stopped.");
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    try { r.start(); setListening(true); } catch { setListening(false); }
  }

  return (
    <button type="button" data-testid="voice-btn" onClick={toggle} disabled={disabled} aria-pressed={listening}
      aria-label={listening ? "Stop voice input" : "Speak your message"} title={error ?? (listening ? "Listening… click to stop" : "Speak your message")}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${listening ? "animate-pulse bg-danger-subtle text-danger" : error ? "text-warn" : "text-muted hover:bg-surface-3 hover:text-ink"}`}>
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
    </button>
  );
}
