import Link from "next/link";
import AdDisclosure from "@/components/AdDisclosure";

const COLS = [
  { title: "Product", links: ["Features", "Privacy", "Open TARGET"] },
  { title: "Company", links: ["Contact"] },
  { title: "Legal", links: ["Terms of Service", "Privacy Policy"] },
];

const HREF: Record<string, string> = {
  Features: "/#features",
  Privacy: "/#privacy",
  "Open TARGET": "/app",
  Contact: "mailto:shadowxpov@gmail.com",
  "Terms of Service": "/terms",
  "Privacy Policy": "/privacy",
};

/** Venice-style footer: deep-sea background, logo + tagline, uppercase column titles, muted links. */
export default function Footer() {
  return (
    <footer className="relative bg-deep-sea px-6 py-16 text-stucco md:px-[5.9vw]">
      <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link href="/" className="font-script text-4xl leading-none text-stucco">Target</Link>
          <p className="mt-3 text-[14px] leading-[21px] text-stucco/60">Your personal AI, for everything.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h4 className="text-[12px] font-semibold uppercase leading-[18px] tracking-[0.05em]">{c.title}</h4>
            <ul className="mt-4 space-y-2">
              {c.links.map((l) => (
                <li key={l}><a href={HREF[l]} className="text-[14px] leading-[21px] text-stucco/60 transition-colors hover:text-stucco">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p data-testid="copyright" className="mx-auto mt-14 max-w-6xl border-t border-white/[0.06] pt-6 text-[13px] text-stucco/40">
        TARGET © {new Date().getFullYear()}. All rights reserved.
      </p>
      <AdDisclosure className="mx-auto mt-2 max-w-6xl text-[13px] text-stucco/40" />
    </footer>
  );
}
