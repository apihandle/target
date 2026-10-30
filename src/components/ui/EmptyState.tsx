export function EmptyState({ title, children, action, testId }: { title: string; children?: React.ReactNode; action?: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-xl2 border border-dashed border-line-strong px-5 py-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry, testId }: { children: React.ReactNode; onRetry?: () => void; testId?: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
      <span className="flex-1">{children}</span>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-full border border-danger/40 px-3 py-1 text-xs font-medium hover:bg-danger/15">Retry</button>}
    </div>
  );
}
