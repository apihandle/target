import Link from "next/link";
import AuthForm from "@/components/AuthForm";
import { safeNext } from "@/lib/ids";

export const metadata = { title: "Sign in · TARGET" };

export default function LoginPage({ searchParams }: { searchParams: { email?: string; next?: string; error?: string } }) {
  const next = safeNext(searchParams.next);
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-blob absolute -left-24 top-10 h-80 w-80 rounded-full bg-orange-500/30 blur-3xl" />
        <div className="animate-blob absolute right-[-6rem] bottom-10 h-96 w-96 rounded-full bg-rose-600/30 blur-3xl [animation-delay:-5s]" />
      </div>
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-600 font-black">◎</span>
        <span className="text-xl font-extrabold tracking-widest">TARGET</span>
      </Link>
      {searchParams.error && <p className="mb-4 text-sm text-rose-400">That link didn&apos;t work. Please sign in again.</p>}
      <AuthForm initialEmail={searchParams.email ?? ""} next={next} />
    </main>
  );
}
