"use client";

export type Chip = { key: string; id?: string; name: string; kind?: string; status?: "uploading" | "ready" | "error"; error?: string };


export default function AttachmentChips({ items, onRemove, align = "start" }: { items: Chip[]; onRemove?: (key: string) => void; align?: "start" | "end" }) {
  if (!items.length) return null;
  return (
    <ul data-testid="attachment-chips" aria-label="Attachments" className={`flex flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
      {items.map((c) => (
        <li key={c.key} data-testid="attachment-chip" title={c.error ?? c.name}
          className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${c.status === "error" ? "border-danger/40 bg-danger-subtle text-danger" : "border-line-strong bg-surface text-ink-soft"}`}>
          {c.status === "uploading" ? <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" /> : <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>}
          <span className="truncate">{c.name}</span>
          {c.status === "uploading" && <span className="sr-only">uploading</span>}
          {c.status === "error" && <span className="sr-only">{c.error}</span>}
          {onRemove && c.status !== "uploading" && (
            <button type="button" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.name}`} className="text-muted hover:text-ink">✕</button>
          )}
        </li>
      ))}
    </ul>
  );
}
