/**
 * "Capabilities" section: mono eyebrow + serif heading, then one glass card per
 * capability (zigzag on desktop) with an icon chip, copy, a blue CTA and a small
 * chat-style preview window.
 */
type Icon = "chat" | "globe" | "lock" | "bolt" | "chart";

const FEATURES: { icon: Icon; eyebrow: string; title: string; body: string; cta: string; href: string; user: string; bot: string; prompt: string }[] = [
  {
    icon: "chat",
    eyebrow: "One thread",
    title: "Life, in one conversation",
    body: "Ask TARGET anything in a single chat: book a birthday dinner, file expenses from email receipts, or run quick research. It remembers what matters to you.",
    cta: "Chat Now",
    href: "/app",
    user: "Plan Riya's birthday dinner on Saturday",
    bot: "Found 3 rooftop spots near you. Want me to book Skyline at 8 pm for 6?",
    prompt: "Type a message...",
  },
  {
    icon: "globe",
    eyebrow: "Autopilot",
    title: "It works the web for you",
    body: "TARGET's agent drives its own secure browser: it researches, fills forms, places orders and builds pages while you get on with your day.",
    cta: "Try Autopilot",
    href: "/app",
    user: "Renew my car insurance",
    bot: "Compared 4 insurers. Cheapest renewal is ₹8,940 with the same cover. Shall I proceed?",
    prompt: "Give TARGET a task...",
  },
  {
    icon: "lock",
    eyebrow: "Vault",
    title: "Locked down by default",
    body: "Logins, cards and connected accounts sit in an encrypted vault no person can open, and TARGET always checks with you before anything that needs approval.",
    cta: "See Privacy",
    href: "#privacy",
    user: "Order the headphones from my cart",
    bot: "Total is ₹2,499 on your saved card. Tap approve and I'll place it.",
    prompt: "Approve or decline...",
  },
  {
    icon: "bolt",
    eyebrow: "Quick actions",
    title: "One tap, task done",
    body: "TARGET suggests the next things on your plate and ranks them. Tap one and it handles the whole job for you.",
    cta: "Open Quick Actions",
    href: "/app",
    user: "What's on my plate today?",
    bot: "Pay the electricity bill, renew your passport, and reply to Riya. Start with the bill?",
    prompt: "Pick a quick action...",
  },
  {
    icon: "chart",
    eyebrow: "Panels",
    title: "Your own mini apps",
    body: "Describe a tracker or dashboard in plain words and TARGET builds it: spending, workouts, packages, scores.",
    cta: "Build a Panel",
    href: "/app",
    user: "Track my monthly spending",
    bot: "Your spending panel is live on Home. You're 12% under budget this month.",
    prompt: "Describe a panel...",
  },
];

function Glyph({ name }: { name: Icon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true" {...common}>
      {name === "chat" && <path d="M4 5h16v11H9l-5 4V5z" />}
      {name === "globe" && (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>)}
      {name === "lock" && (<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>)}
      {name === "bolt" && <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />}
      {name === "chart" && <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />}
    </svg>
  );
}

function Preview({ user, bot, prompt }: { user: string; bot: string; prompt: string }) {
  return (
    <div aria-hidden="true" className="relative overflow-hidden rounded-[16px] border border-white/[0.10] bg-black/30 backdrop-blur-md shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="h-2 w-2 rounded-full bg-white/15" />
        <span className="ml-3 font-script text-[18px] leading-none text-stucco/70">Target</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="ml-auto w-fit max-w-[80%] rounded-[14px] rounded-br-[4px] bg-sea px-3.5 py-2.5 text-[13px] leading-[1.4] text-white">{user}</div>
        <div className="w-fit max-w-[85%] rounded-[14px] rounded-bl-[4px] bg-stucco/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.45] text-stucco/85">{bot}</div>
        <div className="flex items-center justify-between rounded-full border border-white/[0.08] bg-white/[0.03] py-1.5 pl-4 pr-1.5 text-[13px] text-stucco/35">
          {prompt}
          <span className="grid h-7 w-7 place-items-center rounded-full bg-stucco text-[12px] text-deep-sea">↑</span>
        </div>
      </div>
    </div>
  );
}

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-[100px] md:px-8 md:py-[136px]">
      <p className="font-mono text-[13px] uppercase tracking-[0.05em] text-stucco/60">Capabilities</p>
      <h2 className="mt-3 font-display text-[30px] font-normal leading-[1.2] text-stucco md:text-[44px] md:leading-[1.1]">
        Your personal AI, for everything
      </h2>
      <p className="mt-4 max-w-xl text-[16px] leading-[1.45] text-stucco/60 md:text-[18px]">
        Chat, browse, buy, build and track in one place, on the web, iOS and Android.
      </p>
      <div className="mt-14 space-y-6">
        {FEATURES.map((f, i) => (
          <article
            key={f.title}
            data-testid="feature-card"
            className="group relative grid items-center gap-8 overflow-hidden rounded-[24px] border border-white/[0.10] bg-white/[0.035] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-6 transition duration-300 hover:border-white/[0.16] md:grid-cols-2 md:gap-12 md:p-10"
          >
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-48 w-2/3 -translate-x-1/2 rounded-full bg-sun-glint/10 opacity-0 blur-3xl transition duration-500 group-hover:opacity-100" />
            <div className={`relative flex flex-col justify-center ${i % 2 ? "md:order-2" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-sun-glint/20 bg-sun-glint/10 text-sun-glint">
                  <Glyph name={f.icon} />
                </span>
                <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-stucco/50">{f.eyebrow}</span>
              </div>
              <h3 className="mt-5 max-w-[450px] font-display text-[26px] font-normal leading-[1.15] text-stucco md:text-[32px]">{f.title}</h3>
              <p className="mt-3 max-w-[450px] text-[15px] leading-[1.55] text-stucco/60 md:text-[16px]">{f.body}</p>
              <a href={f.href} className="mt-7 inline-flex w-fit items-center gap-2 rounded-[10px] bg-sea px-4 py-3 text-[15px] leading-none text-white transition hover:bg-[#0d4982]">
                {f.cta} <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span>
              </a>
            </div>
            <div className={`relative ${i % 2 ? "md:order-1" : ""}`}>
              <Preview user={f.user} bot={f.bot} prompt={f.prompt} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
