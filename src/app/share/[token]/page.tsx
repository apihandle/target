import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Metadata } from "next";
import { loadSharedConversation, publicContent } from "@/lib/shares";
import { splitSources } from "@/lib/search";
import SourceList from "@/components/SourceList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Shared chats are private-by-link: never indexed, never followed (also sent as X-Robots-Tag, see next.config.mjs).
export const metadata: Metadata = {
  title: "Shared chat · TARGET",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

/** Anonymous client with no session: it can only call the narrow get_shared_conversation() function. */
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function SharedChatPage({ params }: { params: { token: string } }) {
  const client = anonClient();
  const chat = client ? await loadSharedConversation(params.token, client) : null;
  if (!chat) notFound();
  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-black text-accent-ink">◎</span>
            <span className="text-sm font-extrabold tracking-[0.2em]">TARGET</span>
          </span>
          <span className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted">Read-only shared chat</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 data-testid="share-title" className="text-xl font-semibold tracking-tight">{chat.title}</h1>
        <p className="mt-1 text-xs text-muted">Shared from TARGET. The owner can revoke this link at any time.</p>
        <div className="mt-6 space-y-5" data-testid="share-thread">
          {chat.messages.length === 0 && <p className="text-sm text-muted">This chat has no messages.</p>}
          {chat.messages.map((m, i) => (
            <div key={i} data-testid={`share-msg-${m.role}`} className={m.role === "user" ? "flex flex-col items-end" : ""}>
              {!!m.attachments?.length && (
                <ul className="mb-1 flex flex-wrap justify-end gap-1.5" aria-label="Attachments">
                  {m.attachments.map((f, j) => <li key={j} className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11px] text-muted">📎 {f.name}</li>)}
                </ul>
              )}
              {m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-sm text-ink">{m.content}</div>
              ) : (() => {
                const { text, sources } = splitSources(publicContent(m.content));
                return (
                  <div className="prose-target text-sm leading-relaxed text-ink-soft">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                    <SourceList sources={sources} />
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
