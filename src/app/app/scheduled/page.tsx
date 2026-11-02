import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import ScheduledJobs from "@/components/ScheduledJobs";
import { Page, PageHeader } from "@/components/ui/Card";
import { JOB_COLS, type ScheduledJob } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scheduled · TARGET" };

export default async function ScheduledPage() {
  const { supabase, user } = await getSessionOrRedirect("/app/scheduled");
  const [{ data: jobs, error }, { data: projects }] = await Promise.all([
    supabase.from("scheduled_jobs").select(JOB_COLS).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("projects").select("id, name").eq("user_id", user.id).neq("status", "archived").order("updated_at", { ascending: false }).limit(50),
  ]);
  return (
    <AppShell user={user} section="scheduled">
      <Page>
        <PageHeader title="Scheduled prompts" />
        <ScheduledJobs initial={(jobs ?? []) as ScheduledJob[]} projects={(projects ?? []) as { id: string; name: string }[]} unavailable={!!error} />
      </Page>
    </AppShell>
  );
}
