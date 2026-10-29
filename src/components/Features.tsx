const FEATURES = [
  {
    eyebrow: "One thread",
    title: "Life, in one conversation",
    body: "Ask TARGET anything in a single chat: book a birthday dinner, file expenses from email receipts, or run quick research. It remembers what matters to you, so every answer fits.",
    icon: "💬",
    accent: "from-orange-500/30 to-amber-400/10",
  },
  {
    eyebrow: "Autopilot",
    title: "It works the web for you",
    body: "TARGET's agent drives its own secure browser: it researches, fills forms, places orders and builds pages, start to finish, while you get on with your day.",
    icon: "🚀",
    accent: "from-rose-500/30 to-pink-400/10",
  },
  {
    eyebrow: "Vault",
    title: "Locked down by default",
    body: "Logins, cards and connected accounts sit in an encrypted vault no person can open. And TARGET always checks with you before anything that needs your approval.",
    icon: "🔒",
    accent: "from-violet-500/30 to-indigo-400/10",
  },
  {
    eyebrow: "Quick actions",
    title: "One tap, task done",
    body: "TARGET suggests the next things on your plate and ranks them. Tap one and it handles the whole job for you.",
    icon: "⚡",
    accent: "from-emerald-500/30 to-teal-400/10",
  },
  {
    eyebrow: "Panels",
    title: "Your own mini apps",
    body: "Describe a tracker or dashboard in plain words and TARGET builds it: spending, workouts, packages, scores. Ask it questions to dig deeper.",
    icon: "📊",
    accent: "from-sky-500/30 to-cyan-400/10",
  },
];

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <h2 className="text-balance text-center text-3xl font-extrabold tracking-tight sm:text-5xl">
        Everything you need, <span className="bg-gradient-to-r from-orange-400 to-rose-500 bg-clip-text text-transparent">handled</span>
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-center text-white/60">On the web, iOS and Android. Bigger goals like a job hunt or a trip stay organised in Projects.</p>
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        {FEATURES.map((f, idx) => (
          <article
            key={f.title}
            data-testid="feature-card"
            className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br ${f.accent} p-7 transition hover:-translate-y-1 hover:border-white/25 ${idx === 0 ? "md:col-span-2" : ""}`}
          >
            <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-2xl">{f.icon}</div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">{f.eyebrow}</p>
            <h3 className="mt-2 text-2xl font-bold">{f.title}</h3>
            <p className="mt-3 max-w-2xl text-white/70">{f.body}</p>
          </article>
        ))}
      </div>
      <div className="mt-20 rounded-3xl border border-white/10 bg-white/[0.04] p-10 text-center">
        <h2 className="text-balance text-2xl font-extrabold sm:text-4xl">Serious power. Serious security.</h2>
        <p className="mx-auto mt-3 max-w-lg text-white/60">We&apos;re building the most personal AI in the world, and it starts with trust.</p>
        <a href="#signup" data-testid="cta-signup" className="mt-6 inline-block rounded-full bg-gradient-to-r from-orange-500 to-rose-600 px-6 py-3 text-sm font-semibold transition hover:opacity-90">Get started free</a>
      </div>
    </section>
  );
}
