"use client";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";

type Info = { name: string; status: string; capabilities: string[] };

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
      if (c) setInfo({ name: c.name, status: c.status, capabilities: c.capabilities ?? [] });
    }).catch(() => undefined);
    const u = new URL(window.location.href);
    if (taskId) u.searchParams.set("resume", taskId);
    const path = u.pathname + u.search;
    if (path.startsWith("/app")) setBack(path);
  }, [connector, taskId]);
  const name = info?.name ?? connector;
  const connected = info?.status === "connected";
  const href = `/app/connectors?connect=${encodeURIComponent(connector)}&return=${encodeURIComponent(back)}`;
  return (
    <section data-testid="connect-card" data-connector={connector} className="not-prose mt-3 rounded-xl border border-accent/40 bg-surface p-4 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Needs a connection</p>
      <p className="mt-0.5 font-medium text-ink">{connected ? `${name} is connected.` : `Connect ${name} to continue this task.`}</p>
      {!connected && <p className="mt-1 text-xs text-muted">You&apos;ll see exactly what TARGET can access before you connect. The task resumes when you come back.</p>}
      <a href={connected ? back : href} data-testid="connect-btn" className={buttonClass("primary", "sm", "mt-3")}>{connected ? "Continue the task" : `Connect ${name}`}</a>
    </section>
  );
}
