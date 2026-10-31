"use client";
import { useEffect, useState } from "react";

const KEY = "target-welcome-v1";

const STEPS = [
  {
    title: "Ask anything",
    body: "Plan a trip, research a purchase or draft an email. Tap + to attach files, or the mic to speak.",
    icon: "M4 6h16v10H8l-4 4V6z",
  },
  {
    title: "Keep work in Projects",
    body: "Group chats, files and tasks for one goal in a Project, so nothing gets lost.",
    icon: "M3 7h6l2 2h10v10H3V7z",
  },
  {
    title: "You stay in control",
    body: "Anything that acts outside this app waits for your approval in Activity first.",
    icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z",
  },
];

/** A three-step intro shown once to a new user on this device. */
export default function WelcomeTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setStep(0); } catch { /* storage blocked */ }
  }, []);

  function done() {
    try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
    setStep(null);
  }

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-testid="welcome-tour">
      <div className="w-full max-w-sm rounded-3xl border border-line-strong bg-surface/95 p-6 text-center shadow-card backdrop-blur-xl">
        {step === 0 && <p aria-hidden className="font-script text-4xl text-accent">Target</p>}
        <span className="mx-auto mt-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent">
          <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={s.icon} /></svg>
        </span>
        <h2 id="welcome-title" className="mt-4 font-display text-2xl text-ink">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
        <div className="mt-5 flex justify-center gap-1.5" aria-hidden>
          {STEPS.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-accent" : "w-1.5 bg-line-strong"}`} />)}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={done} data-testid="welcome-skip" className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink">Skip</button>
          <button type="button" onClick={() => (last ? done() : setStep(step + 1))} data-testid="welcome-next"
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-strong">
            {last ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
