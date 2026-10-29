"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActionButtons from "@/components/ActionButtons";
import { splitActions } from "@/lib/actions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type UIMsg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Plan a 3-day Goa trip under ₹20,000",
  "Draft a polite email asking for a deadline extension",
  "Explain Supabase RLS like I'm new to it",
  "Give me a 20-minute home workout",
];

export default function Chat({ conversationId: initialId, initialMessages = [], projectId, projectName }: { conversationId?: string; initialMessages?: UIMsg[]; projectId?: string; projectName?: string }) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [messages, setMessages] = useState<UIMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [messages]);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversationId ? { conversationId, message: text } : projectId ? { projectId, message: text } : { message: text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const newId = res.headers.get("X-Conversation-Id") ?? undefined;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      }
      if (newId && newId !== conversationId) {
        setConversationId(newId);
        router.replace(`/app?c=${newId}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {projectId && projectName && (
        <a href={`/app/projects/${projectId}`} data-testid="chat-project" className="mx-auto mt-3 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10">📁 {projectName}</a>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-6" data-testid="thread">
        {messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <h1 className="text-3xl font-extrabold">{projectName ? `New chat in ${projectName}` : "What should we hit today?"}</h1>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <button key={s} data-testid="starter" onClick={() => send(s)} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left text-sm text-white/70 transition hover:bg-white/10">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {messages.map((m, i) => (
              <div key={i} data-testid={`msg-${m.role}`} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-gradient-to-r from-orange-500 to-rose-600 px-4 py-2.5 text-sm">{m.content}</div>
                ) : (
                  <div className="prose-target text-sm leading-relaxed text-white/90">
                    {m.content ? (() => {
                      const { text, actions } = splitActions(m.content);
                      const isLive = streaming && i === messages.length - 1;
                      return (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                          {!isLive && <ActionButtons actions={actions} />}
                        </>
                      );
                    })() : (
                      <span data-testid="typing" className="inline-flex gap-1"><span className="animate-pulse">●</span><span className="animate-pulse [animation-delay:150ms]">●</span><span className="animate-pulse [animation-delay:300ms]">●</span></span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
      {error && <p data-testid="chat-error" className="px-4 pb-2 text-center text-xs text-rose-400">{error}</p>}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="mx-auto mb-4 flex w-full max-w-2xl items-end gap-2 px-4"
      >
        <textarea
          data-testid="chat-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask TARGET anything…"
          className="max-h-40 flex-1 resize-none rounded-3xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-orange-400"
        />
        <button data-testid="chat-send" type="submit" disabled={streaming || !input.trim()} className="h-11 rounded-full bg-gradient-to-r from-orange-500 to-rose-600 px-5 text-sm font-semibold disabled:opacity-40">
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
