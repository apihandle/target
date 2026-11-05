"use client";

/** Anything an admin page throws lands here instead of a blank screen. */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" data-testid="admin-page-error" className="mt-6 rounded-2xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
      <p className="font-medium">This admin page couldn&apos;t load.</p>
      <p className="mt-1 text-danger/80">Check that SUPABASE_SERVICE_ROLE_KEY is set and migration 0019 has run, then retry.</p>
      <button type="button" onClick={reset} className="mt-3 rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium hover:bg-danger/15">Retry</button>
    </div>
  );
}
