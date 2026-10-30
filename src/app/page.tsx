import WaterBackground from "@/components/WaterBackground";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import SignupCard from "@/components/SignupCard";
import Footer from "@/components/Footer";

function SparkleStar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 0c.6 5.6 2.9 10.4 12 12-9.1 1.6-11.4 6.4-12 12-.6-5.6-2.9-10.4-12-12C9.1 10.4 11.4 5.6 12 0z" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="relative isolate w-full overflow-x-hidden text-white">
      <WaterBackground />

      {/* First screen: header, hero, learn-more */}
      <div className="flex min-h-screen min-h-[100svh] flex-col">
        <Navbar />
        <div className="flex flex-1 flex-col justify-center">
          <Hero />
        </div>
        <div className="relative flex w-full flex-col items-center justify-center pb-8 text-center">
          <a href="#features" data-testid="learn-more" className="cursor-pointer text-xs text-gray-400 transition-colors hover:text-white md:text-sm">
            Learn more about TARGET ↓
          </a>
          <SparkleStar className="absolute bottom-9 right-20 hidden h-4 w-4 text-white/70 sm:block md:right-24" />
        </div>
      </div>

      {/* Below the fold */}
      <div className="bg-black/60 backdrop-blur-sm">
        <Features />
        <section className="flex justify-center px-5 pb-24">
          <SignupCard />
        </section>
        <Footer />
      </div>
    </main>
  );
}
