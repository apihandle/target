/**
 * Venice-style "Capabilities" section: mono eyebrow, serif heading, then one
 * deep-sea card per capability with copy + blue CTA on the left and a small
 * live-looking preview on the right.
 */
const FEATURES = [
  {
    title: "Life, in one conversation",
    body: "Ask TARGET anything in a single chat: book a birthday dinner, file expenses from email receipts, or run quick research. It remembers what matters to you.",
    cta: "Chat Now",
    href: "/app",
    bot: "Hi! I'm TARGET. Ask me anything and I'll handle it start to finish.",
    prompt: "Type a message...",
  },
  {
    title: "It works the web for you",
    body: "TARGET's agent drives its own secure browser: it researches, fills forms, places orders and builds pages while you get on with your day.",
    cta: "Try Autopilot",
    href: "/app",
    bot: "Booking a table for 4 at 8 pm… done. Confirmation is in your inbox.",
    prompt: "Book dinner for Friday...",
  },
  {
    title: "Locked down by default",
    body: "Logins, cards and connected accounts sit in an encrypted vault no person can open, and TARGET always checks with you before anything that needs approval.",
    cta: "See Privacy",
    href: "#privacy",
    bot: "This checkout is ₹2,499. Want me to place the order?",
    prompt: "Approve or decline...",
  },
  {
    title: "One tap, task done",
    body: "TARGET suggests the next things on your plate and ranks them. Tap one and it handles the whole job for you.",
    cta: "Open Quick Actions",
    href: "/app",
    bot: "3 things for today: renew passport, pay electricity bill, reply to Riya.",
    prompt: "Pick a quick action...",
  },
  {
    title: "Your own mini apps",
    body: "Describe a tracker or dashboard in plain words and TARGET builds it: spending, workouts, packages, scores.",
    cta: "Build a Panel",
    href: "/app",
    bot: "Your spending panel is live. You're 12% under budget this month.",
    prompt: "Track my spending...",
  },
];

function Preview({ bot, prompt }: { bot: string; prompt: string }) {
  return (
    <div aria-hidden="true" className="flex h-full min-h-[220px] flex-col justify-between rounded-[14px] border border-white/[0.06] bg-[#080f16] p-4">
      <div className="max-w-[85%] rounded-[12px] bg-stucco/[0.06] px-4 py-3 text-[14px] leading-[1.4] text-stucco/80">{bot}</div>
      <div className="mt-6 flex items-center justify-between rounded-full border border-white/[0.08] bg-white/[0.03] py-2 pl-4 pr-2 text-[14px] text-stucco/40">
        {prompt}
        <span className="grid h-7 w-7 place-items-center rounded-full bg-stucco/10 text-stucco/60">↑</span>
      </div>
    </div>
  );
}

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-[100px] md:px-8 md:py-[136px]">
      <p className="font-mono text-[13px] uppercase tracking-[0.05em] text-stucco/60">Capabilities</p>
      <h2 className="mt-3 font-display text-[28px] font-normal leading-[1.25] text-stucco md:text-[40px] md:leading-[1.15]">
        Your personal AI, for everything
      </h2>
      <p className="mt-4 max-w-xl text-[16px] leading-[1.4] text-stucco/60 md:text-[18px]">
        Chat, browse, buy, build and track in one place, on the web, iOS and Android.
      </p>
      <div className="mt-12 space-y-5">
        {FEATURES.map((f) => (
          <article
            key={f.title}
            data-testid="feature-card"
            className="grid gap-8 rounded-[20px] border border-white/[0.06] bg-[#0a121a] p-6 md:grid-cols-2 md:p-10"
          >
            <div className="flex flex-col justify-center">
              <h3 className="max-w-[450px] text-[20px] font-normal leading-[1.2] text-stucco md:text-[24px]">{f.title}</h3>
              <p className="mt-3 max-w-[450px] text-[16px] leading-[1.45] text-stucco/60">{f.body}</p>
              <a href={f.href} className="mt-6 inline-flex w-fit items-center gap-2 rounded-[8px] bg-sea px-4 py-[14px] text-[16px] leading-none text-white transition hover:bg-[#0d4982]">
                {f.cta} <span aria-hidden="true">→</span>
              </a>
            </div>
            <Preview bot={f.bot} prompt={f.prompt} />
          </article>
        ))}
      </div>
    </section>
  );
}
