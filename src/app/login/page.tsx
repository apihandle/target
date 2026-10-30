import AuthForm from "@/components/AuthForm";
import { safeNext } from "@/lib/ids";

export const metadata = { title: "Sign in · TARGET" };

/** Venice-style auth page: warm cream background with one centered card. */
export default function LoginPage({ searchParams }: { searchParams: { email?: string; next?: string; error?: string; mode?: string } }) {
  const next = safeNext(searchParams.next);
  const initialMode = searchParams.mode === "signup" ? "signup" : searchParams.mode === "signin" ? "signin" : undefined;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f7f3ee] px-4 py-10">
      {searchParams.error && <p className="mb-4 text-sm text-rose-600">That link didn&apos;t work. Please sign in again.</p>}
      <AuthForm initialEmail={searchParams.email ?? ""} next={next} initialMode={initialMode} />
    </main>
  );
}
