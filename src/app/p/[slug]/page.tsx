import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Markdown from "@/components/Markdown";
import AdDisclosure from "@/components/AdDisclosure";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PageRow = { title: string; markdown: string; created_at: string; format?: string };

async function load(slug: string): Promise<PageRow | null> {
  if (!/^[a-z0-9-]{6,80}$/.test(slug)) return null;
  try {
    const db = createAdminClient();
    const first = await db.from("pages").select("title, markdown, created_at, format").eq("slug", slug).eq("published", true).maybeSingle();
    // Before migration 0014 there is no format column: every Page is Markdown.
    const data: unknown = first.error ? (await db.from("pages").select("title, markdown, created_at").eq("slug", slug).eq("published", true).maybeSingle()).data : first.data;
    return (data as PageRow | null) ?? null;
  } catch { return null; }
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const p = await load(params.slug);
  return { title: p ? `${p.title} · TARGET` : "Page · TARGET", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** A public Page the owner made with TARGET. Markdown only (react-markdown never renders raw HTML). */
export default async function PublicPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const p = await load(params.slug);
  if (!p) notFound();
  if (p.format === "html") redirect(`/site/${params.slug}`);
  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-script text-2xl text-accent">Target</Link>
          <span className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted">Made with TARGET</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 data-testid="page-title" className="font-serif text-3xl tracking-tight sm:text-4xl">{p.title}</h1>
        <p className="mt-2 text-xs text-muted">{new Date(p.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
        <article className="prose-target mt-8 text-[15px] leading-relaxed text-ink-soft"><Markdown>{p.markdown}</Markdown></article>
      </main>
      <footer className="mx-auto max-w-3xl border-t border-line px-4 py-6 text-xs text-muted">
        <AdDisclosure />
      </footer>
    </div>
  );
}
