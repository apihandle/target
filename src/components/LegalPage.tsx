import Link from "next/link";
import AdDisclosure from "@/components/AdDisclosure";

export default function LegalPage({ title, sections, updated = "October 29, 2026" }: { title: string; sections: { h: string; p: string; id?: string }[]; updated?: string }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="text-sm text-white/50 hover:text-white">← TARGET</Link>
      <h1 className="mt-6 text-3xl font-extrabold">{title}</h1>
      <p className="mt-2 text-xs text-white/40">Last updated {updated}</p>
      {sections.map((s) => (
        <section key={s.h} id={s.id} className="mt-8">
          <h2 className="font-semibold">{s.h}</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/60">{s.p}</p>
        </section>
      ))}
      <footer className="mt-12 border-t border-white/10 pt-6 text-xs text-white/40">
        <AdDisclosure />
      </footer>
    </main>
  );
}
