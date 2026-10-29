const COLS = [
  { title: "Company", links: ["About", "Careers", "News", "Security", "Pricing"] },
  { title: "Resources", links: ["Using TARGET", "Help Center"] },
  { title: "Legal", links: ["Terms of Service", "Privacy Policy"] },
  { title: "Social", links: ["Instagram", "X", "LinkedIn"] },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-14 sm:grid-cols-4">
        {COLS.map((c) => (
          <div key={c.title}>
            <h4 className="text-sm font-semibold">{c.title}</h4>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l}><a href="#" className="text-sm text-white/50 transition hover:text-white">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p data-testid="copyright" className="pb-8 text-center text-xs text-white/40">TARGET © {new Date().getFullYear()}</p>
    </footer>
  );
}
