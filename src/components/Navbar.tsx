export default function Navbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <a href="/" className="flex items-center gap-2" aria-label="TARGET home">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-600 text-sm font-black">◎</span>
          <span className="text-lg font-extrabold tracking-widest">TARGET</span>
        </a>
        <div className="flex items-center gap-3">
          <a href="#features" className="hidden text-sm text-white/70 hover:text-white sm:block">Features</a>
          <a href="#signup" data-testid="nav-signup" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90">Sign Up</a>
        </div>
      </nav>
    </header>
  );
}
