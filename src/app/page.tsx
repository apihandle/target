import WaterBackground from "@/components/WaterBackground";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Privacy from "@/components/Privacy";
import FinalCta from "@/components/FinalCta";
import Footer from "@/components/Footer";

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
        <div className="relative flex w-full flex-col items-center justify-center pb-14 text-center">
          <a href="#features" data-testid="learn-more" className="cursor-pointer text-xs text-sky-accent transition-colors hover:text-white">
            Learn more about TARGET <span aria-hidden="true" className="ml-1.5">↓</span>
          </a>
        </div>
      </div>

      {/* soft fade from the water into the sections */}
      <div aria-hidden="true" className="pointer-events-none relative -mt-32 h-32 bg-gradient-to-b from-transparent to-deep-sea" />

      {/* Below the fold */}
      <div className="relative isolate bg-deep-sea text-stucco">
        <Features />
        <Privacy />
        <FinalCta />
        <Footer />
      </div>
    </main>
  );
}
