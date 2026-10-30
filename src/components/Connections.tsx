"use client";
import { useState } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { buttonClass } from "@/components/ui/Button";
import type { IntegrationStatus, IntegrationView } from "@/lib/integrations/registry";

const STATUS: Record<IntegrationStatus, [string, Tone]> = {
  ready: ["Available", "ok"], connected: ["Connected", "ok"], not_connected: ["Not connected", "neutral"],
  setup_required: ["Setup required", "warn"], unavailable: ["Not available yet", "neutral"],
};

export default function Connections({ initial }: { initial: IntegrationView[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState("");

  async function disconnect(id: string) {
    setError("");
    const r = await fetch(`/api/integrations/${id}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { setError("Couldn't disconnect. Try again."); return; }
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status: "not_connected", accountLabel: undefined, connectedAt: undefined } : x)));
  }

  return (
    <div className="mt-8 space-y-3">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {items.map((i) => {
        const [label, tone] = STATUS[i.status];
        return (
          <article key={i.id} data-testid="integration" data-id={i.id} data-status={i.status} aria-label={i.name} className="rounded-xl2 border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{i.name}</h2>
                  <Badge tone={tone} data-testid="integration-status">{label}</Badge>
                  {i.kind === "builtin" && <span className="text-[11px] text-muted-soft">server-wide</span>}
                </div>
                <p className="mt-1 text-sm text-muted">{i.description}</p>
                {i.accountLabel && <p className="mt-1 text-xs text-ink-soft">Account: {i.accountLabel}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {i.status === "not_connected" && <a href={`/api/integrations/${i.id}/connect`} data-testid="integration-connect" className={buttonClass("primary", "sm")}>Connect</a>}
                {i.status === "connected" && <ConfirmButton label="Disconnect" question={`Disconnect ${i.name}?`} confirmLabel="Disconnect" testId="integration-disconnect" onConfirm={() => disconnect(i.id)} />}
              </div>
            </div>
            {(i.dataAccess.length > 0 || i.capabilities.length > 0) && (
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                {i.dataAccess.length > 0 && <div><dt className="font-medium text-ink-soft">Data it can access</dt>{i.dataAccess.map((d) => <dd key={d} className="mt-0.5 text-muted">{d}</dd>)}</div>}
                <div><dt className="font-medium text-ink-soft">What TARGET can do</dt>{i.capabilities.map((d) => <dd key={d} className="mt-0.5 text-muted">{d}</dd>)}</div>
              </dl>
            )}
            {i.scopes.length > 0 && <p className="mt-2 text-[11px] text-muted-soft">Permission requested: {i.scopes.join(", ")}</p>}
            {i.status === "setup_required" && (
              <p data-testid="integration-setup" className="mt-3 rounded-lg bg-warn-subtle px-3 py-2 text-xs text-warn">
                The site owner needs to add these server settings first: {i.missingEnv.map((e, n) => <span key={e}>{n > 0 && ", "}<code>{e}</code></span>)}. Until then this app can&apos;t be connected and TARGET won&apos;t offer its actions.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
