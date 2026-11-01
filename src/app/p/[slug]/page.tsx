import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Markdown from "@/components/Markdown";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PageRow = { title: string; markdown: string; created_at: string };

async function load(slug: string): Promise<PageRow | null> {
  if (!/^[a-z0-9-]{6,80}$/.test(slug)) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("pages").select("title, markdown, created_at").eq("slug", slug).eq("published", true).maybeSingle();
    return (data as PageRow | null) ?? null;
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await load(params.slug);
  return { title: p ? `${p.title} · TARGET` : "Page · TARGET", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A public Page the owner made with TARGET. Markdown only (react-markdown never renders raw HTML). */
export default async function PublicPage({ params }: { params: { slug: string } }) {
  const p = await load(params.slug);
  if (!p) notFound();
  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <a href="/" className="font-script text-2xl text-accent">Target</a>
          <span className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted">Made with TARGET</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 data-testid="page-title" className="font-serif text-3xl tracking-tight sm:text-4xl">{p.title}</h1>
        <p className="mt-2 text-xs text-muted">{new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
        <article className="prose-target mt-8 text-[15px] leading-relaxed text-ink-soft"><Markdown>{p.markdown}</Markdown></article>
      </main>
    </div>
  );
}
