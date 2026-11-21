import AppShell, { getSessionOrRedirect } from "@/components/AppShell";
import BloggerBlogPicker from "@/components/BloggerBlogPicker";
import ConnectorsGrid from "@/components/ConnectorsGrid";
import GeminiKeyCard from "@/components/GeminiKeyCard";
import MetaPagePicker from "@/components/MetaPagePicker";
import { Page, PageHeader } from "@/components/ui/Card";
import { connectorViews, CONNECTOR_ID } from "@/lib/connectors/registry";
import { listConnections } from "@/lib/connectors/store";
import { safeReturnTo } from "@/lib/connectors/state";
import { SHOWN_CONNECTORS } from "@/lib/connectors/shown";
import { metaPublicInfo, patchMetaViews } from "@/lib/server/socialMeta";
import type { Db } from "@/lib/server/auth";


export const dynamic = "force-dynamic";
export const metadata = { title: "Connectors · TARGET" };

const NOTICES: Record<string, string> = {
  setup: "That connector isn't set up on this server yet.",
  denied: "You cancelled the connection. Nothing was connected.",
  state: "The connection request expired or didn't match your session. Please try again.",
  exchange: "The provider didn't complete the connection. Please try again.",
  start: "Couldn't start the connection. Please try again.",
  rate: "Too many connection attempts. Wait a few minutes and try again.",
  unknown: "Unknown connector.",
};

export default async function ConnectorsPage(
  props: { searchParams: Promise<{ error?: string; connected?: string; connect?: string; return?: string }> }
) {
  const searchParams = await props.searchParams;
  const { supabase, user } = await getSessionOrRedirect("/app/connectors");
  const { conns, loadError } = await listConnections(supabase as unknown as Db, user.id).then(
    (conns) => ({ conns, loadError: false }),
    () => ({ conns: [] as Awaited<ReturnType<typeof listConnections>>, loadError: true }),
  );
  // Only the connectors that work end to end today, in this order.
  const all = connectorViews(process.env, conns);
  // The Facebook card names the picked Page and the Instagram card the linked @username; both live
  // in the sealed "meta" connection, so the views are patched from it (names only, never a token).
  const metaInfo = await metaPublicInfo(user.id).catch(() => null);
  const views = patchMetaViews(
    SHOWN_CONNECTORS.map((id) => all.find((v) => v.id === id)).filter((v): v is NonNullable<typeof v> => !!v),
    metaInfo,
  );
  const notice = searchParams.error ? NOTICES[searchParams.error] ?? "Something went wrong." : null;
  const connected = searchParams.connected && CONNECTOR_ID.test(searchParams.connected) ? views.find((v) => v.id === searchParams.connected) : undefined;
  const focus = searchParams.connect && CONNECTOR_ID.test(searchParams.connect) ? searchParams.connect : undefined;
  return (
    <AppShell user={user} section="connectors">
      <Page wide>
        <PageHeader title="Connectors" />
        {notice && <p role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">{notice}</p>}
        {connected && !notice && <p role="status" className="mt-6 rounded-xl border border-ok/30 bg-ok-subtle px-4 py-3 text-sm text-ok">{connected.name} connected.</p>}
        {loadError && <p role="alert" className="mt-6 rounded-xl border border-warn/30 bg-warn-subtle px-4 py-3 text-sm text-warn">Connection status couldn&apos;t load (apply migration 0007). Connectors are shown as not connected.</p>}
        <ConnectorsGrid initial={views} focus={focus} returnTo={safeReturnTo(searchParams.return)} />
        {views.find((v) => v.id === "facebook")?.status === "connected" && <MetaPagePicker />}
        {views.find((v) => v.id === "blogger")?.status === "connected" && <BloggerBlogPicker />}
        <GeminiKeyCard />
      </Page>
    </AppShell>
  );
}
