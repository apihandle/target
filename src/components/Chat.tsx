"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ActionButtons from "@/components/ActionButtons";
import { splitActions } from "@/lib/actions";
import SourceList from "@/components/SourceList";
import { splitSources } from "@/lib/search";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ErrorNote } from "@/components/ui/EmptyState";

export type UIMsg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Plan a 3-day Goa trip under ₹20,000",
  "Help me organize everything I need to do this week",
  "Research the best budget laptops for students and compare 3",
  "Draft a polite email asking for a deadline extension",
];

type Props = {
  conversationId?: string; initialMessages?: UIMsg[]; projectId?: string; projectName?: string;
  /** False when no AI provider is configured on the server: chat shows a setup state instead of fake replies. */
  aiConfigured?: boolean; webAvailable?: boolean;
  /** Pre-filled (not sent) text, e.g. from a quick action. */
  initialPrompt?: string;
  taskId?: string; taskTitle?: string;
  /** Task paused for a connection that the user has just connected: continue it once on open. */
  resumeTaskId?: string;
};

export default function Chat({ conversationId: initialId, initialMessages = [], projectId, projectName, aiConfigured = true, webAvailable = true, initialPrompt = "", taskId, taskTitle, resumeTaskId }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [messages, setMessages] = useState<UIMsg[]>(initialMessages);
  const [input, setInput] = useState(initialPrompt);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [web, setWeb] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taskUsed = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (initialPrompt) inputRef.current?.focus(); }, [initialPrompt]);
  const resumed = useRef(false);
  useEffect(() => {
    if (!resumeTaskId || resumed.current || !aiConfigured) return;
    resumed.current = true;
    send("I've connected it. Please continue.", { resumeTaskId });
  }, [resumeTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  function stop() { abortRef.current?.abort(); }

  async function send(textArg?: string, opts: { retry?: boolean; resumeTaskId?: string } = {}) {
    const text = (textArg ?? input).trim();
    if (!text || streaming || !aiConfigured) return;
    setError(null); setFailedText(null);
    if (!opts.retry) setInput("");
    setMessages((m) => (opts.retry ? [...m, { role: "assistant", content: "" }] : [...m, { role: "user", content: text }, { role: "assistant", content: "" }]));
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let newId: string | undefined;
    try {
      const sendTask = taskId && !taskUsed.current;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          ...(conversationId ? { conversationId } : projectId ? { projectId } : {}),
          message: text,
          ...(web ? { web: true } : {}),
          ...(opts.retry && conversationId ? { retry: true } : {}),
          ...(opts.resumeTaskId ? { taskId: opts.resumeTaskId, resume: true } : sendTask ? { taskId } : {}),
        }),
      });
      if (sendTask) taskUsed.current = true;
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (j.conversationId && !conversationId) setConversationId(j.conversationId);
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      newId = res.headers.get("X-Conversation-Id") ?? undefined;
      if (newId && newId !== conversationId) setConversationId(newId);
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
      if ((newId && newId !== initialId) || opts.resumeTaskId) router.replace(`/app?c=${newId ?? conversationId ?? ""}`);
      router.refresh();
    } catch (e) {
      if (ctrl.signal.aborted) {
        // User pressed Stop: keep what arrived and mark it.
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role !== "assistant") return m;
          if (!last.content) return m.slice(0, -1);
          return [...m.slice(0, -1), { ...last, content: last.content + "\n\n_[Response stopped]_" }];
        });
        if (newId && newId !== initialId) router.replace(`/app?c=${newId}`);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setFailedText(text);
        setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const contextLabel = taskTitle ? `Task: ${taskTitle}` : projectName ? `Project: ${projectName}` : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 items-center justify-center gap-2 border-b border-line px-14 py-2 md:px-4">
        {projectId && projectName ? (
          <a href={`/app/projects/${projectId}`} data-testid="chat-project" className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-ink-soft hover:bg-surface-2">
            <span className="text-muted">Working in</span> 📁 {projectName}
          </a>
        ) : (
          <span className="text-xs text-muted">General chat · not in a project</span>
        )}
        {taskTitle && <span data-testid="chat-task" className="hidden truncate rounded-full border border-info/30 bg-info-subtle px-3 py-1 text-xs text-info sm:inline">{contextLabel}</span>}
      </div>

      {!aiConfigured && (
        <div role="status" data-testid="ai-setup" className="mx-auto mt-4 w-full max-w-2xl px-4">
          <div className="rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">
            <strong className="font-semibold">AI isn&apos;t set up on this server yet.</strong> Add <code>NVIDIA_API_KEY</code> or <code>OPENROUTER_API_KEY</code> to the server environment to enable replies. Your chats, projects, tasks and panels still work.
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6" data-testid="thread" aria-live="polite" aria-busy={streaming}>
        {messages.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xl text-center sm:mt-12">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{projectName ? `New chat in ${projectName}` : "What should we get done?"}</h1>
            <p className="mt-2 text-sm text-muted">Plan, research or organize. TARGET drafts and prepares; anything that acts outside this app waits for your approval.</p>
            <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
              {STARTERS.map((s) => (
                <button key={s} data-testid="starter" disabled={!aiConfigured} onClick={() => send(s)}
                  className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft transition hover:border-line-strong hover:bg-surface-2 disabled:opacity-50">
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
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-sm text-ink">{m.content}</div>
                ) : (
                  <div className="prose-target text-sm leading-relaxed text-ink-soft">
                    {m.content ? (() => {
                      const { text: withSources, actions } = splitActions(m.content);
                      const { text, sources } = splitSources(withSources);
                      const isLive = streaming && i === messages.length - 1;
                      return (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                          {!isLive && <SourceList sources={sources} />}
                          {!isLive && <ActionButtons actions={actions} />}
                        </>
                      );
                    })() : (
                      <span data-testid="typing" role="status" aria-label="TARGET is thinking" className="inline-flex gap-1 text-muted"><span className="animate-pulse">●</span><span className="animate-pulse [animation-delay:150ms]">●</span><span className="animate-pulse [animation-delay:300ms]">●</span></span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {error && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-2">
          <ErrorNote testId="chat-error" onRetry={failedText ? () => send(failedText, { retry: true }) : undefined}>{error}</ErrorNote>
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mx-auto mb-4 flex w-full max-w-2xl items-end gap-2 px-4">
        <button
          type="button"
          data-testid="web-toggle"
          aria-pressed={web}
          disabled={!webAvailable}
          title={webAvailable ? "Search the web for this message" : "Web search isn't set up on this server"}
          onClick={() => setWeb((w) => !w)}
          className={`h-11 rounded-full border px-3 text-xs font-semibold transition disabled:opacity-40 ${web ? "border-accent bg-accent-subtle text-accent-strong" : "border-line-strong bg-surface text-muted hover:text-ink"}`}
        >
          🌐 Web
        </button>
        <label htmlFor="chat-input" className="sr-only">Message TARGET</label>
        <textarea
          id="chat-input"
          ref={inputRef}
          data-testid="chat-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={!aiConfigured ? "AI isn't configured" : web ? "Search the web…" : "Ask TARGET anything…"}
          className="max-h-40 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm text-ink outline-none placeholder:text-muted-soft focus:border-accent"
        />
        {streaming ? (
          <button data-testid="chat-stop" type="button" onClick={stop} className="h-11 rounded-full border border-line-strong bg-surface-2 px-4 text-sm font-semibold text-ink hover:bg-surface-3">Stop</button>
        ) : (
          <button data-testid="chat-send" type="submit" disabled={!input.trim() || !aiConfigured} className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-40">
            Send
          </button>
        )}
      </form>
    </div>
  );
}
