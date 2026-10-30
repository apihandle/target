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
          <div key={t.title} className="rounded-[20px] border border-white/[0.06] bg-[#0a121a] p-6">
            <p className="font-mono text-[12px] uppercase tracking-[0.05em] text-sky-accent">{t.tier}</p>
            <h3 className="mt-1 text-[22px] font-medium leading-[1.1] text-stucco">{t.title}</h3>
            <p className="mt-3 text-[15px] leading-[1.45] text-stucco/60">{t.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
