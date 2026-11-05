import Link from "next/link";
import { requireAdminPage } from "@/lib/server/adminAuth";
import { cleanFeedbackFilters, feedbackCounts, loadFeedback } from "@/lib/server/adminFeedback";
import { pageFrom } from "@/lib/adminConfig";
import { CATEGORY_LABEL, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, STATUS_LABEL } from "@/lib/feedback";
import { Badge, type Tone } from "@/components/ui/Badge";
import FeedbackActions from "@/components/admin/FeedbackActions";
import { Chips, Empty, fmt, LoadError, Pager, SearchBox, SectionHeading, sp } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = { new: "warn", seen: "info", done: "ok" };
const CAT_TONE: Record<string, Tone> = { bug: "danger", idea: "accent", other: "neutral" };

export default async function AdminFeedback(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireAdminPage();
  const raw = await props.searchParams;
  const f = cleanFeedbackFilters({ status: sp(raw.status), category: sp(raw.category), q: sp(raw.q) });
  const params: Record<string, string | undefined> = { ...f, page: sp(raw.page) };
  const [r, counts] = await Promise.all([loadFeedback(db, { ...f, page: pageFrom(params.page) }), feedbackCounts(db)]);
  const qs = new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString();
  const filtered = !!(f.status || f.category || f.q);
  const base = "/admin/feedback";
  return (
    <div data-testid="admin-feedback">
      <SectionHeading title="Feedback" description={counts ? `${counts.new} new · ${counts.seen} seen · ${counts.done} done. Sent from Settings → Send feedback and the app sidebar.` : "Messages users send from the app."}
        actions={<a href={`/api/admin/feedback/export${qs ? `?${qs}` : ""}`} download className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3" data-testid="feedback-export">Export CSV</a>} />
      <Chips base={base} params={params} name="status" label="Status" options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: counts ? `${STATUS_LABEL[s]} (${counts[s]})` : STATUS_LABEL[s] }))} />
      <Chips base={base} params={params} name="category" label="Type" options={FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
      <SearchBox base={base} params={params} placeholder="Search feedback text" />
      <div className="mt-4 space-y-2" data-testid="feedback-list">
        {r.error && <LoadError retryHref={base}>Couldn&apos;t load feedback. Run supabase/migrations/0020_ai_usage_feedback.sql if you haven&apos;t yet.</LoadError>}
        {!r.error && r.rows.length === 0 && (
          <Empty title={filtered ? "No feedback matches these filters" : "No feedback yet"}>
            {filtered ? <Link href={base} className="text-accent hover:underline">Clear filters</Link> : "When people send feedback from the app, it shows up here."}
          </Empty>
        )}
        {r.rows.map((x) => (
          <article key={x.id} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl" data-testid="feedback-row">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{STATUS_LABEL[x.status] ?? x.status}</Badge>
              <Badge tone={CAT_TONE[x.category] ?? "neutral"}>{CATEGORY_LABEL[x.category] ?? x.category}</Badge>
              <span>{fmt(x.created_at)}</span>
              <Link href={`/admin/users/${x.user_id}`} className="ml-auto max-w-[220px] truncate text-accent hover:underline">{x.email || x.user_id.slice(0, 8)}</Link>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{x.message}</p>
            {x.page_path && <p className="mt-1 break-all font-mono text-[11px] text-muted-soft">from {x.page_path}</p>}
            <FeedbackActions id={x.id} status={x.status} note={x.admin_note} />
          </article>
        ))}
      </div>
      {!r.error && <Pager base={base} params={params} page={r.page} pages={r.pages} total={r.total} />}
    </div>
  );
}
