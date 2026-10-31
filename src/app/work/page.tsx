import type { Metadata } from "next";
import WaterBackground from "@/components/WaterBackground";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WorkBoard from "@/components/WorkBoard";
import { WORK_FAQ } from "@/lib/workFaq";

const URL = "https://gettarget.vercel.app/work";
const TITLE = "Earn Online by Watching Ads: Free Work Page, No Limit | TARGET";
const DESC = "Earn coins online for free on TARGET Work. Watch ads from simple links, no daily limit, no app, no investment. Open multiple links, even in different browsers, and get rewards in your account.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["earn online", "earn money online", "online earning", "watch ads and earn", "earn by watching ads", "free earning website", "earning app without investment", "online work from home", "earn rewards", "paid to watch ads", "online paise kaise kamaye", "TARGET work"],
  alternates: { canonical: URL },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" } },
  openGraph: { type: "website", url: URL, title: "TARGET Work: earn coins by watching ads, no limit", description: DESC, siteName: "TARGET" },
  twitter: { card: "summary_large_image", title: "TARGET Work: earn coins by watching ads", description: DESC },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "@id": URL, url: URL, name: TITLE, description: DESC, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "TARGET", url: "https://gettarget.vercel.app" } },
    { "@type": "HowTo", name: "How to earn on TARGET Work", step: [
      { "@type": "HowToStep", text: "Open gettarget.vercel.app/work and log in for free." },
      { "@type": "HowToStep", text: "Tap any ad link. It opens in a new tab." },
      { "@type": "HowToStep", text: "Stay on the ad for at least 15 seconds." },
      { "@type": "HowToStep", text: "Come back to the Work page. Coins are added to your account." },
    ] },
    { "@type": "FAQPage", mainEntity: WORK_FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ],
};

export default function WorkPage() {
  return (
    <main className="relative isolate min-h-[100svh] w-full overflow-x-hidden text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <WaterBackground />
      <Navbar />
      <div className="pt-6 md:pt-10"><WorkBoard /></div>
      <section aria-labelledby="work-faq" className="relative mx-auto w-full max-w-2xl px-4 pb-16">
        <h2 id="work-faq" className="font-display text-3xl text-white">Earn online with TARGET Work</h2>
        <p className="mt-2 text-sm leading-relaxed text-stucco/70">A free earning page: watch ads, get coins in your account. No limit, no app, no investment.</p>
        <div className="mt-5 space-y-3">
          {WORK_FAQ.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-xl">
              <summary className="cursor-pointer list-none text-[15px] font-medium text-white">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-stucco/75">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
