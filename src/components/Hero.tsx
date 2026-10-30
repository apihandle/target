"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const Icon = {
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sparkles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  ),
  layout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10.5l6-3.5v10l-6-3.5" />
    </svg>
  ),
  dice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M4 20l9-9" /><path d="M15 4v3" /><path d="M15 11v3" /><path d="M11 7.5h-3" /><path d="M22 7.5h-3" /><path d="M18.5 4l-1.5 1.5" /><path d="M11.5 4l1.5 1.5" />
    </svg>
  ),
};

export const CHIPS = [
  { icon: Icon.globe, label: "Learn about the World", prompt: "Tell me something fascinating about the world today" },
  { icon: Icon.sparkles, label: "Create Anything", prompt: "Help me create " },
  { icon: Icon.layout, label: "Create Websites", prompt: "Build me a website for " },
  { icon: Icon.dice, label: "Surprise Me", prompt: null },
] as const;

export const SURPRISES = [
  "Why does the ocean glow at night?",
  "Plan a weekend in Goa and find me the cheapest flights from Patna.",
  "Write a haiku about rain on a tin roof",
  "Explain black holes like I'm ten",
  "Give me a 20-minute home workout",
];

export default function Hero() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/app?q=${encodeURIComponent(q)}&send=1`);
  }

  function pick(prompt: string | null) {
    const text = prompt ?? SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
    setQuery(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <section className="flex min-h-[75vh] flex-col items-center justify-center px-4 pt-[16vh] text-center">
      <h1 className="animate-fade-up mb-5 font-display text-4xl font-normal tracking-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.45)] md:text-[2.75rem]">
        Ask anything
      </h1>

      <form
        onSubmit={submit}
        data-testid="hero-search"
        className="flex w-full max-w-[37rem] items-center rounded-full border border-white/10 bg-white/[0.08] py-2 pl-4 pr-2 shadow-2xl backdrop-blur-xl transition-all focus-within:border-white/25"
      >
        <label htmlFor="hero-q" className="sr-only">Ask me anything</label>
        <input
          id="hero-q"
          ref={inputRef}
          data-testid="hero-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask me anything privately..."
          autoComplete="off"
          className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-gray-400"
        />
        <button
          type="submit"
          aria-label="Send"
          data-testid="hero-submit"
          disabled={!query.trim()}
          className="ml-2 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/20 text-white transition-all hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M12 19V5" /><path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>

      <div className="mt-3.5 flex max-w-[44rem] flex-wrap items-center justify-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            data-testid="hero-chip"
            onClick={() => pick(c.prompt)}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-gray-200 backdrop-blur-md transition-all hover:bg-white/20"
          >
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
