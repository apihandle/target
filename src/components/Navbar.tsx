export default function Navbar() {
  return (
    <header className="relative z-30">
      <nav className="flex items-center justify-between px-6 py-6 md:px-12">
        <a href="/" aria-label="TARGET home" className="font-script text-2xl leading-none text-white md:text-3xl">
          Target
        </a>
        <a
          href="/login"
          data-testid="nav-signup"
          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-md transition-all duration-200 hover:bg-white/20"
        >
          Sign up
        </a>
      </nav>
    </header>
  );
}
