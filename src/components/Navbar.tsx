const LINKS = [
  { label: "Features", href: "#features" },
  { label: "Privacy", href: "#privacy" },
  { label: "Get started", href: "#signup" },
];

/** Venice-style top bar: script logo, quiet centre links, blue "Log in" text + glass "Sign up" button. */
export default function Navbar() {
  return (
    <header className="relative z-30">
      <nav className="flex items-center justify-between px-4 py-3 md:px-6">
        <a href="/" aria-label="TARGET home" className="font-script text-3xl leading-none text-stucco [text-shadow:0_1px_8px_rgba(0,0,0,0.4)] md:text-4xl">
          Target
        </a>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className="rounded-full px-3 py-1 text-sm font-medium text-stucco/60 transition hover:text-stucco">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <a href="/login" data-testid="nav-login" className="hidden px-3 text-sm font-medium text-sun-glint transition hover:text-stucco sm:block">
            Log in
          </a>
          <a
            href="/login?mode=signup"
            data-testid="nav-signup"
            className="whitespace-nowrap rounded-[10px] border border-stucco/10 bg-stucco/[0.08] px-4 py-[9px] text-sm text-stucco backdrop-blur-md transition hover:bg-stucco/[0.14]"
          >
            Sign up
          </a>
        </div>
      </nav>
    </header>
  );
}
