import { cloneElement, isValidElement, type ReactElement } from "react";

export const inputClass = "w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted-soft outline-none transition-colors focus:border-accent aria-[invalid=true]:border-danger";

/** Label + control + hint + error, wired with aria attributes. Pass a single input/textarea/select as child. */
export function Field({ id, label, hint, error, children, optional }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; children: ReactElement }) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-ink-soft">
        {label}{optional && <span className="ml-1 font-normal text-muted-soft">(optional)</span>}
      </label>
      {control}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-soft">{hint}</p>}
      {error && <p id={`${id}-error`} data-testid={`${id}-error`} className="text-xs text-danger">{error}</p>}
    </div>
  );
}
