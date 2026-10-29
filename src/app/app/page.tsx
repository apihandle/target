import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · TARGET" };

export default async function AppHome() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-rose-600 text-sm font-black">◎</span>
          <span className="font-extrabold tracking-widest">TARGET</span>
        </span>
        <form action="/auth/signout" method="post">
          <button data-testid="signout" className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Sign out</button>
        </form>
      </header>
      <section className="mt-16">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Welcome 👋</h1>
        <p className="mt-2 text-white/60">Signed in as <span data-testid="user-email" className="text-white">{user.email}</span></p>
        <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-white/60">
          Your chat with TARGET is coming next.
        </div>
      </section>
    </main>
  );
}
