import RotatingPrompts from "./RotatingPrompts";
import SignupCard from "./SignupCard";

export default function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 pb-16 pt-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-blob absolute -left-24 top-10 h-80 w-80 rounded-full bg-orange-500/40 blur-3xl" />
        <div className="animate-blob absolute right-[-6rem] top-40 h-96 w-96 rounded-full bg-rose-600/40 blur-3xl [animation-delay:-5s]" />
        <div className="animate-blob absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-violet-600/30 blur-3xl [animation-delay:-9s]" />
      </div>
      <div className="animate-fade-up text-center">
        <p className="mb-4 inline-block rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.25em] text-white/60">Personal AI</p>
        <h1 className="text-balance text-5xl font-extrabold tracking-tight sm:text-7xl">
          Aim it. <span className="bg-gradient-to-r from-orange-400 to-rose-500 bg-clip-text text-transparent">TARGET</span> handles it.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-balance text-base text-white/70 sm:text-lg">
          One AI that plans, books, orders and organises your life, so you can get off the screen.
        </p>
      </div>
      <RotatingPrompts />
      <div className="mt-6 flex w-full justify-center">
        <SignupCard />
      </div>
    </section>
  );
}
