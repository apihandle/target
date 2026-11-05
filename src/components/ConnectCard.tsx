"use client";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";

type Info = { name: string; status: string; capabilities: string[]; needsReconnect?: string[] };

/**
 * Shown in chat when a task paused because a connector isn't connected. Links to the Connectors page,
 * which returns here with ?resume=<task> after connecting so the chat continues the task.
 */
export default function ConnectCard({ connector, taskId }: { connector: string; taskId?: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [back, setBack] = useState("/app");
  useEffect(() => {
    fetch("/api/connectors").then((r) => r.json()).then((j) => {
      const c = (j.connectors ?? []).find((x: { id: string }) => x.id === connector);
      if (c) setInfo({ name: c.name, status: c.status, capabilities: c.capabilities ?? [], needsReconnect: c.needsReconnect });
    }).catch(() => undefined);
    const u = new URL(window.location.href);
    if (taskId) u.searchParams.set("resume", taskId);
    const path = u.pathname + u.search;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads window.location after mount so server and client markup match
    if (path.startsWith("/app")) setBack(path);
  }, [connector, taskId]);
  const name = info?.name ?? connector;
  const upgrade = info?.status === "connected" && !!info.needsReconnect?.length;
  const connected = info?.status === "connected" && !upgrade;
  const href = `/app/connectors?connect=${encodeURIComponent(connector)}&return=${encodeURIComponent(back)}`;
  return (
    <section data-testid="connect-card" data-connector={connector} className="not-prose mt-3 rounded-xl border border-accent/40 bg-surface p-4 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Needs a connection</p>
      <p className="mt-0.5 font-medium text-ink">{connected ? `${name} is connected.` : upgrade ? `Reconnect ${name} to allow this.` : `Connect ${name} to continue this task.`}</p>
      {upgrade && <p className="mt-1 text-xs text-muted">TARGET needs a permission you haven&apos;t granted yet ({info!.needsReconnect!.join(", ")}). Reconnect and approve it on {name}; the task resumes when you come back.</p>}
      {!connected && !upgrade && <p className="mt-1 text-xs text-muted">You&apos;ll see exactly what TARGET can access before you connect. The task resumes when you come back.</p>}
      <a href={connected ? back : href} data-testid="connect-btn" className={buttonClass("primary", "sm", "mt-3")}>{connected ? "Continue the task" : upgrade ? `Reconnect ${name}` : `Connect ${name}`}</a>
    </section>
  );
}
