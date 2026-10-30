export default function Navbar() {
  return (
    <header className="relative z-30">
      <nav className="flex items-center justify-between px-4 py-3 md:px-4">
        <a href="/" aria-label="TARGET home" className="font-script text-3xl leading-none text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.4)] md:text-4xl">
          Target
        </a>
        <a
          href="/login"
          data-testid="nav-signup"
          className="rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-sm text-white/90 shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/20"
        >
          Sign up
        </a>
      </nav>
    </header>
  );
}
