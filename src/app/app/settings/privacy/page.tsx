import { SettingsBack } from "@/components/SettingsList";
import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import MemoryManager from "@/components/MemoryManager";
import ClearActivity from "@/components/ClearActivity";
import { Card, Page, PageHeader, SectionTitle } from "@/components/ui/Card";
import { loadSettings } from "@/lib/settings";
import type { Memory } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy & memory · TARGET" };

export default async function PrivacyPage() {
  const { supabase, user } = await getSessionOrRedirect("/app/settings/privacy");
  const [{ data: mems }, settings] = await Promise.all([
    supabase.from("memories").select("id, content, source, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
    loadSettings(supabase, user.id),
  ]);
  return (
    <AppShell user={user} section="settings">
      <Page>
        <SettingsBack />
        <div className="mt-3"><PageHeader title="Privacy & memory" description="What TARGET stores, who can see it, and how to change or delete it." /></div>

        <section aria-labelledby="what" className="mt-8">
          <SectionTitle id="what">How your data is handled in this version</SectionTitle>
          <Card className="space-y-3 text-sm leading-relaxed text-ink-soft" data-testid="privacy-statement">
            <p><strong className="text-ink">Where it&apos;s stored.</strong> Your chats, projects, tasks, panels, approvals, activity and memories are stored in TARGET&apos;s Supabase (Postgres) database. Database row-level security limits each row to the account that owns it, and every server endpoint also checks that you own what you&apos;re reading or changing.</p>
            <p><strong className="text-ink">What this does not mean.</strong> This data is not end-to-end encrypted. TARGET doesn&apos;t add its own encryption to chats or memories, so people who operate the database or hosting (for example the site owner) could technically access it.</p>
            <p><strong className="text-ink">AI and search providers.</strong> To answer you, your message, the chat history, project instructions, open task titles and (if memory is on) your saved memories are sent to the configured AI provider (NVIDIA NIM or OpenRouter). When web search runs, a query based on your message is sent to Tavily. Their own privacy terms apply.</p>
            <p><strong className="text-ink">Passwords and cards.</strong> Sign-in is handled by Supabase Auth; TARGET never sees or stores your password. TARGET doesn&apos;t ask for or store payment cards. Don&apos;t paste passwords, card numbers or API keys into chat: chat text is stored like any other message.</p>
            <p><strong className="text-ink">Connectors.</strong> If you connect an account (e.g. Supabase, GitHub or Google), its access token is encrypted on the server (AES-256-GCM) in a column browsers can&apos;t read. Text the agent reads from your accounts is sent to the AI provider as data for your request. Disconnecting revokes access with the provider where possible and deletes the stored token.</p>
            <p><strong className="text-ink">Ads.</strong> TARGET&apos;s public pages show ads from a third-party network (Monetag), which may use cookies. The ad script is set up not to load on workspace (/app), sign-in or auth pages, and TARGET doesn&apos;t share your chats, memories or projects with advertisers.</p>
          </Card>
        </section>

        <section aria-labelledby="mem" className="mt-10">
          <SectionTitle id="mem">Memory</SectionTitle>
          <MemoryManager initial={(mems ?? []) as Memory[]} enabled={settings.memory_enabled} embedded />
        </section>

        <section aria-labelledby="hist" className="mt-10">
          <SectionTitle id="hist">Activity history</SectionTitle>
          <p className="mb-3 text-xs text-muted">Clearing removes the activity log only. Your projects, tasks and approval records stay.</p>
          <ClearActivity />
        </section>
      </Page>
    </AppShell>
  );
}
