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
import AttachmentChips, { type Chip } from "@/components/AttachmentChips";
import ModelPicker, { type ModelChoice } from "@/components/ModelPicker";
import VoiceButton from "@/components/VoiceButton";
import TemplatesMenu from "@/components/TemplatesMenu";
import ShareButton from "@/components/ShareButton";
import { ACCEPT_ATTR, ATTACHMENT_BUCKET, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES, safeFileName, storageKeyName, typeFor } from "@/lib/attachments";

export type UIMsg = { role: "user" | "assistant"; content: string; attachments?: { name: string; kind: string }[] };

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
  /** Send initialPrompt once on open (a question asked on the landing page). */
  autoSend?: boolean;
  taskId?: string; taskTitle?: string;
  /** Task paused for a connection that the user has just connected: continue it once on open. */
  resumeTaskId?: string;
  /** Model picker options (server allow-list incl. "auto") and the user's remembered choice. */
  models?: ModelChoice[]; initialModel?: string;
};

export default function Chat({ conversationId: initialId, initialMessages = [], projectId, projectName, aiConfigured = true, webAvailable = true, initialPrompt = "", autoSend = false, taskId, taskTitle, resumeTaskId, models = [], initialModel = "auto" }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [messages, setMessages] = useState<UIMsg[]>(initialMessages);
  const [input, setInput] = useState(initialPrompt);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [web, setWeb] = useState(false);
  const [chips, setChips] = useState<Chip[]>([]);
  const [model, setModel] = useState(initialModel);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = chips.some((c) => c.status === "uploading");
  const ready = chips.filter((c) => c.status === "ready" && c.id);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taskUsed = useRef(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);
  // Follow the reply while it streams, but don't yank the view if the user scrolled up to read.
  useEffect(() => { if (atBottom) endRef.current?.scrollIntoView?.({ behavior: "smooth" }); }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  function onThreadScroll() {
    const el = threadRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }
  function jumpToBottom() { endRef.current?.scrollIntoView?.({ behavior: "smooth" }); setAtBottom(true); }
  async function copyMessage(i: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500); } catch { /* clipboard blocked */ }
  }
  function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || streaming) return;
    setMessages((m) => (m[m.length - 1]?.role === "assistant" ? m.slice(0, -1) : m));
    send(lastUser.content, { retry: true, regenerate: true });
  }
  useEffect(() => { if (initialPrompt) inputRef.current?.focus(); }, [initialPrompt]);
  const autoSent = useRef(false);
  useEffect(() => {
    if (!autoSend || autoSent.current || !aiConfigured || !initialPrompt.trim()) return;
    autoSent.current = true;
    send(initialPrompt);
  }, [autoSend]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumed = useRef(false);
  useEffect(() => {
    if (!resumeTaskId || resumed.current || !aiConfigured) return;
    resumed.current = true;
    send("I've connected it. Please continue.", { resumeTaskId });
  }, [resumeTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  function stop() { abortRef.current?.abort(); }

  const patchChip = (key: string, p: Partial<Chip>) => setChips((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));

  /** Upload straight to the private bucket (own folder only), then let the server validate and read it. */
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setError(null);
    const room = MAX_ATTACHMENTS_PER_MESSAGE - chips.filter((c) => c.status !== "error").length;
    const files = Array.from(list);
    if (files.length > room) setError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
    for (const f of files.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = safeFileName(f.name);
      const t = typeFor(name);
      if (!t) { setChips((c) => [...c, { key, name, status: "error", error: "Only PDF, images, TXT and CSV files can be attached." }]); continue; }
      if (f.size > MAX_ATTACHMENT_BYTES) { setChips((c) => [...c, { key, name, kind: t.kind, status: "error", error: "Files can be at most 10 MB." }]); continue; }
      setChips((c) => [...c, { key, name, kind: t.kind, status: "uploading" }]);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Sign in again to attach files.");
        const path = `${user.id}/${crypto.randomUUID()}/${storageKeyName(name)}`;
        const { error: upErr } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, f, { contentType: t.mime, upsert: false });
        if (upErr) throw new Error("Upload failed. Check the file and try again.");
        const r = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, name: f.name }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Upload failed");
        patchChip(key, { status: "ready", id: j.attachment.id, error: j.readable ? undefined : "No readable text found in this file." });
      } catch (e) {
        patchChip(key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeChip(key: string) {
    const c = chips.find((x) => x.key === key);
    if (c?.id) fetch(`/api/attachments/${c.id}`, { method: "DELETE" }).catch(() => undefined);
    setChips((cs) => cs.filter((x) => x.key !== key));
  }

  async function send(textArg?: string, opts: { retry?: boolean; regenerate?: boolean; resumeTaskId?: string } = {}) {
    const text = (textArg ?? input).trim();
    const files = opts.retry ? [] : ready;
    if ((!text && !files.length) || streaming || !aiConfigured || (uploading && !opts.retry)) return;
    setError(null); setFailedText(null);
    if (!opts.retry) { setInput(""); setChips([]); }
    const shown = text || (files.length > 1 ? "Please take a look at the attached files." : "Please take a look at the attached file.");
    const atts = files.map((c) => ({ name: c.name, kind: c.kind ?? "" }));
    setMessages((m) => (opts.retry ? [...m, { role: "assistant", content: "" }] : [...m, { role: "user", content: shown, ...(atts.length ? { attachments: atts } : {}) }, { role: "assistant", content: "" }]));
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
          ...(files.length ? { attachmentIds: files.map((c) => c.id) } : {}),
          ...(models.length > 1 && model !== "auto" ? { model } : {}),
          ...(web ? { web: true } : {}),
          ...(opts.retry && conversationId ? { retry: true } : {}),
          ...(opts.regenerate && conversationId ? { regenerate: true } : {}),
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
        setFailedText(shown);
        setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const contextLabel = taskTitle ? `Task: ${taskTitle}` : projectName ? `Project: ${projectName}` : null;

  const hasContent = !!input.trim() || ready.length > 0;
  const sendButton = (
    <button data-testid="chat-send" type="submit" aria-label="Send" title="Send"
      disabled={!hasContent || uploading || !aiConfigured}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:bg-accent-strong disabled:opacity-40">
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  );

  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  const iconBtn = "grid h-8 w-8 place-items-center rounded-full text-muted-soft transition hover:bg-surface-3 hover:text-ink";

  return (
    <div className="relative flex h-full flex-col">
      <div className="relative flex min-h-12 items-center justify-center gap-2 px-14 py-2 pr-20 md:pl-4 md:pr-24">
        {projectId && projectName && (
          <a href={`/app/projects/${projectId}`} data-testid="chat-project" className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-line-strong bg-surface/80 px-3 py-1 text-xs text-ink-soft backdrop-blur hover:bg-surface-2">
            <span className="text-muted">Working in</span> {projectName}
          </a>
        )}
        {conversationId && messages.length > 0 && <div className="absolute right-3 top-2"><ShareButton conversationId={conversationId} /></div>}
        {taskTitle && <span data-testid="chat-task" className="hidden truncate rounded-full border border-info/30 bg-info-subtle px-3 py-1 text-xs text-info sm:inline">{contextLabel}</span>}
      </div>

      {!aiConfigured && (
        <div role="status" data-testid="ai-setup" className="mx-auto mt-4 w-full max-w-2xl px-4">
          <div className="rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">
            <strong className="font-semibold">AI isn&apos;t set up on this server yet.</strong> Add <code>NVIDIA_API_KEY</code> or <code>OPENROUTER_API_KEY</code> to the server environment to enable replies. Your chats, projects, tasks and panels still work.
          </div>
        </div>
      )}

      <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 overflow-y-auto px-4 py-6" data-testid="thread" aria-live="polite" aria-busy={streaming}>
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center pb-10 text-center">
            <p aria-hidden className="font-script text-5xl text-accent sm:text-6xl">Target</p>
            <h1 className="mt-3 font-display text-3xl tracking-tight text-ink sm:text-4xl">{projectName ? `New chat in ${projectName}` : "What can I do for you?"}</h1>
            <p className="mt-3 max-w-md text-sm text-muted">Plan, research or organize. Anything that acts outside this app waits for your approval.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} data-testid="starter" disabled={!aiConfigured} onClick={() => send(s)}
                  className="rounded-full border border-line-strong bg-surface/80 px-4 py-2 text-[13px] text-ink-soft backdrop-blur transition hover:border-accent/50 hover:text-ink disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {messages.map((m, i) => {
              const prevSame = i > 0 && messages[i - 1].role === m.role;
              if (m.role === "user") {
                return (
                  <div key={i} data-testid="msg-user" className={`flex flex-col items-end gap-1 ${prevSame ? "" : "pt-2"}`}>
                    {!!m.attachments?.length && <AttachmentChips align="end" items={m.attachments.map((a, j) => ({ key: `${i}-${j}`, name: a.name, kind: a.kind }))} />}
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-[22px] rounded-br-md border border-accent/25 bg-accent/15 px-4 py-2.5 text-[15px] leading-relaxed text-ink">{m.content}</div>
                  </div>
                );
              }
              const isLive = streaming && i === messages.length - 1;
              if (!m.content) {
                return (
                  <div key={i} data-testid="msg-assistant" className="flex">
                    <span data-testid="typing" role="status" aria-label="TARGET is thinking" className="inline-flex items-center gap-1.5 rounded-[22px] rounded-bl-md border border-line bg-surface/85 px-4 py-3.5 backdrop-blur-xl">
                      <span className="typing-dot" /><span className="typing-dot [animation-delay:160ms]" /><span className="typing-dot [animation-delay:320ms]" />
                    </span>
                  </div>
                );
              }
              const { text: withSources, actions } = splitActions(m.content);
              const { text, sources } = splitSources(withSources);
              return (
                <div key={i} data-testid="msg-assistant" className="group flex flex-col items-start">
                  <div className="prose-target max-w-[92%] rounded-[22px] rounded-bl-md border border-line bg-surface/85 px-4 py-3 text-[15px] leading-relaxed text-ink-soft backdrop-blur-xl">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                    {!isLive && <SourceList sources={sources} />}
                    {!isLive && <ActionButtons actions={actions} />}
                  </div>
                  {!isLive && (
                    <div className="mt-1 flex items-center gap-0.5 pl-1">
                      <button type="button" data-testid="copy-reply" aria-label={copied === i ? "Copied" : "Copy reply"} title={copied === i ? "Copied" : "Copy"} onClick={() => copyMessage(i, text)} className={iconBtn}>
                        {copied === i ? (
                          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                        ) : (
                          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
                        )}
                      </button>
                      {i === lastAssistant && conversationId && aiConfigured && (
                        <button type="button" data-testid="regenerate-reply" aria-label="Regenerate reply" title="Regenerate" onClick={regenerate} disabled={streaming} className={iconBtn}>
                          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {!atBottom && messages.length > 0 && (
        <button type="button" data-testid="jump-bottom" onClick={jumpToBottom} aria-label="Jump to latest"
          className="absolute bottom-36 left-1/2 z-10 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-surface/90 text-ink shadow-card backdrop-blur-xl hover:bg-surface-2">
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
        </button>
      )}

      {error && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-2">
          <ErrorNote testId="chat-error" onRetry={failedText ? () => send(failedText, { retry: true }) : undefined}>{error}</ErrorNote>
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}
        className="mx-auto mb-4 w-full max-w-2xl space-y-2 px-4">
        <AttachmentChips items={chips} onRemove={removeChip} />
        <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" data-testid="file-input" aria-hidden tabIndex={-1}
          onChange={(e) => addFiles(e.target.files)} />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="web-toggle"
            aria-pressed={web}
            disabled={!webAvailable}
            title={webAvailable ? "Search the web for this message" : "Web search isn't set up on this server"}
            onClick={() => setWeb((w) => !w)}
            className={`h-8 rounded-full border px-3 text-xs font-semibold transition disabled:opacity-40 ${web ? "border-accent bg-accent-subtle text-accent-strong" : "border-line-strong bg-surface text-muted hover:text-ink"}`}
          >
            Web
          </button>
          <TemplatesMenu current={input} disabled={!aiConfigured} onPick={(p) => { setInput(p); inputRef.current?.focus(); }} />
          <ModelPicker options={models} value={model} onChange={setModel} disabled={!aiConfigured || streaming} />
        </div>
        {/* One pill composer: + attaches files, mic on the right turns into a send arrow once there's something to send */}
        <div className="flex items-end gap-1.5 rounded-[26px] border border-accent/60 bg-surface/90 p-1.5 backdrop-blur-xl focus-within:border-accent">
          <button type="button" data-testid="attach-btn" disabled={!aiConfigured || streaming} onClick={() => fileRef.current?.click()}
            title="Attach PDF, image, TXT or CSV (max 10 MB)" aria-label="Attach files"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-40">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
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
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-ink outline-none focus-visible:outline-none placeholder:text-muted-soft"
          />
          {streaming ? (
            <button data-testid="chat-stop" type="button" onClick={stop} aria-label="Stop" title="Stop"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-3 text-ink hover:bg-line-strong">
              <span aria-hidden className="h-3 w-3 rounded-[3px] bg-current" />
            </button>
          ) : hasContent ? (
            sendButton
          ) : (
            <VoiceButton disabled={!aiConfigured} fallback={sendButton}
              onText={(t) => setInput((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t))} />
          )}
        </div>
      </form>
    </div>
  );
}
