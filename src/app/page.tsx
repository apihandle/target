import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Footer from "@/components/Footer";
import AdTag from "@/components/AdTag";

export default function Home() {
  return (
    <main>
      <AdTag />
      <Navbar />
      <Hero />
      <Features />
      <Footer />
    </main>
  );
}
