import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage, isAdminEmailListed } from "@/lib/server/adminAuth";
import { isBanned, loadUserDetail, loadUserExtras } from "@/lib/server/adminData";
import { isUuid } from "@/lib/ids";
import { countryName, flagOf } from "@/lib/presence";
import { Badge, toneFor } from "@/components/ui/Badge";
import ConfirmAction from "@/components/admin/ConfirmAction";
import { Empty, fmt, KV, LoadError, num, Panel, truncate } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminUserDetail(props: { params: Promise<{ id: string }> }) {
  const { db, user: me } = await requireAdminPage();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const d = await loadUserDetail(db, id);
  if (d === null) notFound();
  const back = <Link href="/admin/users" className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">← Users</Link>;
  if (d === "error") return <>{back}<div className="mt-3"><LoadError retryHref={`/admin/users/${id}`}>Couldn&apos;t load this user.</LoadError></div></>;
  const u = d.user;
  const x = await loadUserExtras(db, id);
  const banned = isBanned(u);
  const self = u.id === me.id;
  const admin = isAdminEmailListed(u.email);
  return (
    <>
      {back}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-semibold text-ink">{u.email || "(no email)"}</h2>
          <p className="mt-0.5 break-all font-mono text-[11px] text-muted-soft">{u.id}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={banned ? "danger" : "ok"}>{banned ? "Disabled" : "Active"}</Badge>
            {admin && <Badge tone="accent">Admin</Badge>}
            <Badge>{u.provider}</Badge>
          </div>
        </div>
        <div data-testid="user-status-action">
          {banned ? (
            <ConfirmAction label="Enable user" title="Enable this user?" message={<>They can sign in to TARGET again: <b className="break-all">{u.email}</b></>} confirmLabel="Enable" variant="primary"
              url={`/api/admin/users/${u.id}/status`} body={{ disabled: false }} testId="user-enable" successText="User enabled." />
          ) : (
            <ConfirmAction label="Disable user" title="Disable this user?" message={<>They are signed out of TARGET and can&apos;t sign in until you enable them again. Nothing is deleted. <b className="break-all">{u.email}</b></>}
              confirmLabel="Disable" danger variant="danger" disabled={self || admin} url={`/api/admin/users/${u.id}/status`} body={{ disabled: true }} testId="user-disable" successText="User disabled." />
          )}
          {(self || admin) && !banned && <p className="mt-1 text-xs text-muted-soft">{self ? "You can't disable yourself." : "Admins can't be disabled here."}</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel>
          <h3 className="text-sm font-semibold text-ink">Account</h3>
          <dl className="mt-2 divide-y divide-line">
            <KV k="Joined" v={fmt(u.created_at)} />
            <KV k="Last sign-in" v={fmt(u.last_sign_in_at)} />
            <KV k="Last seen in the app" v={fmt(d.presence?.last_seen_at)} />
            <KV k="Country" v={d.presence?.country ? `${flagOf(d.presence.country)} ${countryName(d.presence.country)}` : "—"} />
            <KV k="Device" v={d.presence?.device ?? "—"} />
            {banned && <KV k="Disabled until" v={fmt(u.banned_until)} />}
            <KV k="Chats" v={num(d.counts.conversations)} />
            <KV k="Messages" v={num(d.counts.messages)} />
            <KV k="Browser jobs" v={num(d.counts.browser_jobs)} />
            <KV k="Scheduled prompts" v={num(d.counts.scheduled_jobs)} />
            <KV k="Share links" v={num(d.counts.share_links)} />
            <KV k="Vault items" v={`${num(d.counts.vault_items)} (contents never shown)`} />
            <KV k="Custom AI providers" v={`${num(d.counts.custom_providers)} (keys never shown)`} />
          </dl>
        </Panel>
        <Panel testId="user-task-mode">
          <h3 className="text-sm font-semibold text-ink">Task mode</h3>
          <p className="mt-1 text-sm text-muted">{x.taskModeChats == null ? "—" : x.taskModeChats === 0 ? "Off in every chat." : `On in ${x.taskModeChats} chat${x.taskModeChats === 1 ? "" : "s"}.`} Payments and deletes always wait for the user&apos;s card.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ConfirmAction label="Turn off everywhere" title="Turn Task mode off?" message="Every chat of this user goes back to asking on approval cards." confirmLabel="Turn off"
              disabled={!x.taskModeChats} url={`/api/admin/users/${u.id}/task-mode`} body={{ on: false }} testId="task-mode-off" successText="Task mode is off." />
            <ConfirmAction label="Turn on everywhere" title="Turn Task mode on?" message="Approval cards in all of this user's chats are approved automatically (payments and deletes still wait)." confirmLabel="Turn on"
              url={`/api/admin/users/${u.id}/task-mode`} body={{ on: true }} testId="task-mode-on" successText="Task mode is on." />
          </div>
        </Panel>
        <Panel testId="user-vault">
          <h3 className="text-sm font-semibold text-ink">Vault ({x.vault.length}) and saved sign-ins ({x.sessions.length})</h3>
          <p className="mt-0.5 text-xs text-muted-soft">Labels only; values are never shown.</p>
          {x.vault.length === 0 ? <p className="mt-2 text-sm text-muted">No vault items.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {x.vault.map((v, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="min-w-0 truncate text-ink">{v.label}{v.site ? <span className="text-muted"> · {v.site}</span> : null}</span><Badge>{v.kind}</Badge></li>
              ))}
            </ul>
          )}
          {x.sessions.length > 0 && (
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {x.sessions.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="min-w-0 truncate text-ink">{s.domain}</span><Badge tone={toneFor(s.status)}>{s.status}</Badge></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <h3 className="text-sm font-semibold text-ink">Connected apps ({d.connections.length})</h3>
          {d.connections.length === 0 ? <p className="mt-2 text-sm text-muted">None.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {d.connections.map((c) => (
                <li key={c.connector_id} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="text-ink">{c.connector_id}</span><Badge tone={toneFor(c.status)}>{c.status}</Badge></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-ink">Recent activity</h3>
      <div className="mt-2 space-y-2" data-testid="user-activity">
        {d.activity.length === 0 ? <Empty title="No activity yet" /> : d.activity.map((e) => (
          <div key={e.id} className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted"><Badge>{e.category}</Badge>{e.status && <Badge tone={toneFor(e.status)}>{e.status}</Badge>}<span className="ml-auto">{fmt(e.created_at)}</span></div>
            <p className="mt-1 break-words text-sm text-ink">{e.title}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Recent browser jobs</h3>
          <div className="mt-2 space-y-2">
            {d.jobs.length === 0 ? <Empty title="No browser jobs" /> : d.jobs.map((j) => (
              <div key={j.id} className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted"><Badge tone={j.status === "done" ? "ok" : j.status === "failed" ? "danger" : "neutral"}>{j.status}</Badge><span>{j.mode}</span><span className="ml-auto">{fmt(j.created_at)}</span></div>
                <p className="mt-1 break-words text-sm text-ink">{truncate(j.goal, 140)}</p>
                {j.error && <p className="mt-1 break-words text-xs text-danger">{j.error}</p>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Recent errors</h3>
          <div className="mt-2 space-y-2">
            {d.errors.length === 0 ? <Empty title="No errors" /> : d.errors.map((e) => (
              <div key={e.id} className="rounded-xl border border-line bg-surface/80 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted"><Badge>{e.source}</Badge><span className="ml-auto">{fmt(e.created_at)}</span></div>
                <p className="mt-1 break-words text-sm text-ink">{e.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-6 text-xs text-muted-soft">Chat contents, vault values, connector tokens and provider keys are never shown in the admin panel.</p>
    </>
  );
}
