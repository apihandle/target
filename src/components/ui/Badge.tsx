export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-ink-soft",
  accent: "border-accent/30 bg-accent-subtle text-accent-strong",
  ok: "border-ok/30 bg-ok-subtle text-ok",
  warn: "border-warn/30 bg-warn-subtle text-warn",
  danger: "border-danger/30 bg-danger-subtle text-danger",
  info: "border-info/30 bg-info-subtle text-info",
};

export function Badge({ tone = "neutral", children, className = "", ...rest }: { tone?: Tone; children: React.ReactNode; className?: string; "data-testid"?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]} ${className}`} {...rest}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  queued: "neutral", planning: "info", in_progress: "info", waiting_approval: "warn", needs_connection: "warn", completed: "ok", failed: "danger", cancelled: "neutral",
  pending: "warn", approved: "info", executing: "info", executed: "ok", rejected: "neutral",
  active: "accent", paused: "neutral", archived: "neutral",
  connected: "ok", expired: "warn", revoked: "danger", not_connected: "neutral", setup_required: "warn",
};
export const toneFor = (status: string | null | undefined): Tone => (status ? STATUS_TONE[status] ?? "neutral" : "neutral");

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const dot = status === "in_progress" || status === "planning" || status === "executing";
  return (
    <Badge tone={toneFor(status)} data-testid="status-badge">
      {dot && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </Badge>
  );
}
