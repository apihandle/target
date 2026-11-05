/** Skeleton while an admin page loads its data on the server. */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" data-testid="admin-loading" className="mt-6 space-y-3">
      <div className="h-6 w-40 animate-pulse rounded-full bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-line bg-surface/60" />)}
      </div>
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-line bg-surface/60" />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
