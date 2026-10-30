"use client";

export type Chip = { key: string; id?: string; name: string; kind?: string; status?: "uploading" | "ready" | "error"; error?: string };

const ICON: Record<string, string> = { pdf: "📄", image: "🖼", text: "📝", csv: "📊" };

export default function AttachmentChips({ items, onRemove, align = "start" }: { items: Chip[]; onRemove?: (key: string) => void; align?: "start" | "end" }) {
  if (!items.length) return null;
  return (
    <ul data-testid="attachment-chips" aria-label="Attachments" className={`flex flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
      {items.map((c) => (
        <li key={c.key} data-testid="attachment-chip" title={c.error ?? c.name}
          className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${c.status === "error" ? "border-danger/40 bg-danger-subtle text-danger" : "border-line-strong bg-surface text-ink-soft"}`}>
          <span aria-hidden>{c.status === "uploading" ? "⏳" : ICON[c.kind ?? ""] ?? "📎"}</span>
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
