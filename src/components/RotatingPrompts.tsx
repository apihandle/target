"use client";
import { useEffect, useState } from "react";

export const PROMPTS = [
  "Plan a weekend in Goa and find me the cheapest flights from Patna.",
  "Order my usual paneer tikka from my favourite place.",
  "Sort my inbox and tell me what actually needs a reply.",
  "Find a dentist near me and book a checkup for Saturday.",
  "Track my monthly spending and show me where I can save.",
  "Build me a portfolio page for my projects.",
];

export default function RotatingPrompts({ interval = 3000 }: { interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % PROMPTS.length), interval);
    return () => clearInterval(t);
  }, [interval]);
  return (
    <div className="mt-8 flex min-h-[72px] items-center justify-center" aria-live="polite">
      <p key={i} data-testid="rotating-prompt" className="animate-fade-up max-w-xl rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center text-sm text-white/80 backdrop-blur sm:text-base">
        “{PROMPTS[i]}”
      </p>
    </div>
  );
}
