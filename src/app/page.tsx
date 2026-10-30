import WaterBackground from "@/components/WaterBackground";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import SignupCard from "@/components/SignupCard";
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
          <a href="#features" data-testid="learn-more" className="cursor-pointer text-xs text-[#7f9fe0] transition-colors hover:text-white">
            Learn more about TARGET <span aria-hidden="true" className="ml-1.5">↓</span>
          </a>
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
