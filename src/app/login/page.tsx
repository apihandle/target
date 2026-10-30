import AuthForm from "@/components/AuthForm";
import WaterBackground from "@/components/WaterBackground";
import { safeNext } from "@/lib/ids";

export const metadata = { title: "Sign in · TARGET" };

/** Auth page: the same moving water as the home hero, with one dark glass card. */
export default function LoginPage({ searchParams }: { searchParams: { email?: string; next?: string; error?: string; mode?: string } }) {
  const next = safeNext(searchParams.next);
  const initialMode = searchParams.mode === "signup" ? "signup" : searchParams.mode === "signin" ? "signin" : undefined;
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center px-4 py-10 text-stucco">
      <WaterBackground />
      {searchParams.error && <p className="mb-4 text-sm text-rose-400">That link didn&apos;t work. Please sign in again.</p>}
      <AuthForm initialEmail={searchParams.email ?? ""} next={next} initialMode={initialMode} />
    </main>
  );
}
