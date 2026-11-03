import Link from "next/link";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import PanelTile, { AddPanelTile } from "@/components/home/PanelTile";
import ForYou, { type ForYouItem } from "@/components/ForYou";
import { PANEL_COLS, type Panel } from "@/lib/panels";
import { type Approval } from "@/lib/approvals";
import { loadSettings, quickActionHref } from "@/lib/settings";
import { greeting } from "@/lib/greeting";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · TARGET" };

export default async function HomePage() {
  const { supabase, user } = await getSessionOrRedirect("/app/home");
  const [{ data: panels, error: pErr }, { data: approvals, error: aErr }, settings, { data: forYou }] = await Promise.all([
    supabase.from("panels").select(PANEL_COLS).eq("user_id", user.id).order("position").order("created_at").limit(12),
    supabase.from("approval_requests").select("id, action_type, summary, destination, created_at").eq("user_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(10),
    loadSettings(supabase, user.id),
    // Before migration 0014 the table doesn't exist; the strip simply stays hidden.
    supabase.from("suggestions").select("id, kind, title, detail, prompt, due_at").eq("user_id", user.id).eq("status", "open").order("created_at", { ascending: false }).limit(3),
  ]);
  if (pErr || aErr) console.error("home: workspace data failed to load (migrations applied?)", pErr?.message ?? "", aErr?.message ?? "");

  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  const name = (meta?.full_name || meta?.name || "").trim().split(/\s+/)[0] || undefined;
  const pending = (approvals ?? []) as Pick<Approval, "id" | "summary" | "destination">[];
  const tiles = (panels ?? []) as Panel[];
  const quick = settings.quick_actions.filter((a) => !settings.hidden_quick_actions.includes(a.id)).slice(0, 6);

  return (
    <AppShell user={user} section="home">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-16 sm:px-6 md:pt-12">
        <h1 data-testid="home-greeting" className="text-[26px] font-semibold tracking-tight text-ink sm:text-3xl">{greeting()}{name ? `, ${name}` : ""}</h1>

        <form action="/app" method="get" role="search" aria-label="Ask TARGET" data-testid="home-ask" className="mt-5">
          <input type="hidden" name="send" value="1" />
          <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface/90 py-1.5 pl-4 pr-1.5 shadow-card focus-within:border-accent/60">
            <label htmlFor="home-ask-input" className="sr-only">Ask TARGET</label>
            <input id="home-ask-input" name="q" required maxLength={2000} autoComplete="off" enterKeyHint="send" placeholder="Ask TARGET…"
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted-soft focus:outline-none" />
            <button type="submit" aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink hover:bg-accent-strong">
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>

        {quick.length > 0 && (
          <nav aria-label="Quick actions" className="-mx-4 mt-3 sm:-mx-6">
            <ul data-testid="quick-actions" className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
              {quick.map((a) => (
                <li key={a.id} className="shrink-0">
                  <Link href={quickActionHref(a)} data-testid="quick-action" className="block whitespace-nowrap rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink">{a.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {pending.length > 0 && (
          <section aria-labelledby="attn-title" data-testid="home-approvals" className="mt-6 overflow-hidden rounded-2xl border border-accent/30 bg-accent-subtle/60">
            <Link href="/app/activity?filter=approvals" className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent-subtle">
              <h2 id="attn-title" className="text-sm font-semibold text-ink">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-hidden />
                {pending.length === 1 ? "1 thing needs you" : `${pending.length}${pending.length >= 10 ? "+" : ""} things need you`}
              </h2>
              <span className="text-xs font-medium text-accent">Review →</span>
            </Link>
            <ul className="divide-y divide-accent/15 border-t border-accent/15">
              {pending.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <Link href="/app/activity?filter=approvals" className="flex items-baseline gap-2 px-4 py-2.5 text-sm hover:bg-accent-subtle">
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{a.summary}</span>
                    {a.destination && <span className="shrink-0 text-xs text-muted">{a.destination}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!forYou?.length && (
          <section aria-labelledby="fy-title" className="mt-6">
            <h2 id="fy-title" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-soft">For you</h2>
            <ForYou initial={forYou as ForYouItem[]} compact />
          </section>
        )}

        <section aria-labelledby="panels-title" className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="panels-title" className="text-xs font-medium uppercase tracking-wider text-muted-soft">Panels</h2>
            {tiles.length > 0 && <Link href="/app/panels" className="text-xs text-muted hover:text-ink">Manage</Link>}
          </div>
          <div data-testid="home-panels" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((p) => <PanelTile key={p.id} p={p} />)}
            <AddPanelTile labelled={tiles.length === 0} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
