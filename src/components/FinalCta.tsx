/** Venice-style closing CTA over the water: big serif line, solid blue + outline buttons. */
export default function FinalCta() {
  return (
    <section id="signup" className="relative overflow-hidden px-6 py-[120px] text-center md:px-8 md:py-[180px]">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cover bg-center opacity-70" style={{ backgroundImage: "url(/water-poster.webp)" }} />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-deep-sea via-deep-sea/40 to-deep-sea" />
      <h2 className="font-display text-[34px] font-normal leading-[1.2] text-stucco md:text-[56px]">
        Start with Target.<br />
        <span className="text-stucco/60">Privately.</span>
      </h2>
      <p className="mx-auto mt-5 max-w-md text-[16px] leading-[1.45] text-stucco/60 md:text-[18px]">Your personal AI that gets things done. No credit card required.</p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <a href="/login?mode=signup" data-testid="cta-signup" className="rounded-[10px] bg-sun-glint px-6 py-[14px] font-mono text-[14px] leading-none text-deep-sea transition hover:bg-[#f0d6a4]">
          Sign Up for Free
        </a>
        <a href="#features" className="rounded-[10px] border border-stucco/[0.24] px-6 py-[14px] font-mono text-[14px] leading-none text-stucco transition hover:bg-stucco/[0.06]">
          Explore Features
        </a>
      </div>
    </section>
  );
}
