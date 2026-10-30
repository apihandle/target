const TIERS = [
  { tier: "Layer 1", title: "Encrypted vault", body: "Passwords, cards and API keys are encrypted at rest. No person, including us, can open them." },
  { tier: "Layer 2", title: "You approve", body: "Payments, messages and anything binding wait for your tap before TARGET acts." },
  { tier: "Layer 3", title: "Your memory, your call", body: "See, edit or delete anything TARGET remembers about you, any time." },
  { tier: "Layer 4", title: "Scoped connections", body: "Connected apps get only the access a task needs, and you can revoke them in one click." },
];

/** Venice-style "Privacy Architecture" section: four quiet numbered tier cards. */
export default function Privacy() {
  return (
    <section id="privacy" className="mx-auto max-w-6xl px-6 py-[100px] md:px-8 md:py-[136px]">
      <p className="font-mono text-[13px] uppercase tracking-[0.05em] text-stucco/60">Privacy Architecture</p>
      <h2 className="mt-3 font-display text-[28px] font-normal leading-[1.25] text-stucco md:text-[40px] md:leading-[1.15]">
        AI that respects your privacy
      </h2>
      <p className="mt-4 max-w-xl text-[16px] leading-[1.4] text-stucco/60 md:text-[18px]">
        TARGET does real work in your accounts, so trust is built into every step.
      </p>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => (
          <div key={t.title} className="group relative overflow-hidden rounded-[24px] border border-white/[0.10] bg-white/[0.035] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-6 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-sun-glint">{t.tier}</p>
              <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-[9px] border border-sun-glint/20 bg-sun-glint/10 text-sun-glint">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="m9 12 2 2 4-4" /></svg>
              </span>
            </div>
            <h3 className="mt-6 font-display text-[24px] font-normal leading-[1.15] text-stucco">{t.title}</h3>
            <p className="mt-3 text-[15px] leading-[1.45] text-stucco/60">{t.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
