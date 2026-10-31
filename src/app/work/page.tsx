import WaterBackground from "@/components/WaterBackground";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WorkBoard from "@/components/WorkBoard";

export const metadata = { title: "Work · TARGET", description: "Open ad links and earn coins in your TARGET account." };

export default function WorkPage() {
  return (
    <main className="relative isolate min-h-[100svh] w-full overflow-x-hidden text-white">
      <WaterBackground />
      <Navbar />
      <div className="pt-6 md:pt-10"><WorkBoard /></div>
      <Footer />
    </main>
  );
}
