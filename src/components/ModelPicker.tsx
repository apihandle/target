"use client";

export type ModelChoice = { id: string; label: string; vision?: boolean };

/**
 * Model dropdown. Options come from the server (only configured NVIDIA/OpenRouter models; the server
 * re-validates every request). Changing it remembers the choice for this user.
 */
export default function ModelPicker({ options, value, onChange, disabled }: { options: ModelChoice[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  if (options.length <= 1) return null;
  function pick(id: string) {
    onChange(id);
    fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferred_model: id }) }).catch(() => undefined);
  }
  return (
    <label className="inline-flex min-w-0 items-center gap-1 text-xs text-muted">
      <span className="sr-only">AI model</span>
      <select data-testid="model-picker" value={value} disabled={disabled} onChange={(e) => pick(e.target.value)}
        title="Which AI model answers first. If it's unavailable, TARGET falls back to the others."
        className="h-8 max-w-[11rem] truncate rounded-full border border-line-strong bg-surface px-2 text-xs text-ink-soft outline-none focus:border-accent sm:max-w-[14rem]">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.vision ? " 👁" : ""}</option>)}
      </select>
    </label>
  );
}
