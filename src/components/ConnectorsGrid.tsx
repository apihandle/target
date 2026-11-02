"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import type { ConnectorView, UiStatus } from "@/lib/connectors/registry";

const STATUS: Record<UiStatus, [string, Tone]> = {
  connected: ["Connected", "ok"], expired: ["Expired: reconnect", "warn"], revoked: ["Revoked", "danger"],
  not_connected: ["Not connected", "neutral"], setup_required: ["Setup required", "warn"],
};

type Props = { initial: ConnectorView[]; focus?: string; returnTo?: string | null };

export default function ConnectorsGrid({ initial, focus, returnTo }: Props) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(focus && initial.some((c) => c.id === focus) ? focus : null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { focusRef.current?.scrollIntoView?.({ block: "center" }); }, []);

  const setError = (id: string, m: string) => setErrors((e) => ({ ...e, [id]: m }));

  async function saveKey(c: ConnectorView) {
    const apiKey = (keys[c.id] ?? "").trim();
    if (!apiKey) { setError(c.id, `Paste your ${c.apiKey?.label ?? "token"} first.`); return; }
    setBusy(c.id); setError(c.id, "");
    try {
      const r = await fetch(`/api/connectors/${c.id}/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(c.id, j.error ?? "Couldn't connect."); return; }
      setKeys((k) => ({ ...k, [c.id]: "" }));
      setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, status: "connected", accountLabel: j.accountLabel } : x)));
      setOpen(null);
      if (returnTo) window.location.assign(returnTo);
    } catch { setError(c.id, "Network error. Nothing was saved."); }
    finally { setBusy(null); }
  }

  async function disconnect(c: ConnectorView) {
    setError(c.id, "");
    const r = await fetch(`/api/connectors/${c.id}/disconnect`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) { setError(c.id, "Couldn't disconnect. Try again."); return; }
    setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, status: "not_connected", accountLabel: undefined } : x)));
  }

  const oauthHref = (c: ConnectorView) => `/api/connectors/${c.id}/connect${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`;

  return (
    <div className="mt-6 divide-y divide-line overflow-hidden rounded-xl2 border border-line bg-surface shadow-card" data-testid="connectors-grid">
      {items.filter((c) => c.status !== "setup_required").map((c) => {
        const [label, tone] = STATUS[c.status];
        const canConnect = c.status !== "setup_required" && c.status !== "connected";
        const isOpen = open === c.id && canConnect && !c.methods.oauth;
        const connectLabel = c.status === "expired" || c.status === "revoked" ? "Reconnect" : "Connect";
        return (
          <article key={c.id} ref={c.id === focus ? (el) => { focusRef.current = el; } : undefined}
            data-testid="connector-card" data-id={c.id} data-status={c.status} aria-label={c.name}
            className={`px-4 py-3 ${c.id === focus ? "bg-accent-subtle/40" : ""}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent-subtle text-sm font-black text-accent">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium text-ink">{c.name}</h2>
                {c.status === "connected" && c.accountLabel
                  ? <p className="truncate text-xs text-ink-soft">{c.accountLabel}</p>
                  : c.status !== "not_connected" && <Badge tone={tone} data-testid="connector-status">{label}</Badge>}
              </div>
              <div className="flex shrink-0 gap-2">
                {canConnect && c.methods.oauth && (
                  <a href={oauthHref(c)} data-testid="connector-oauth" className={buttonClass("primary", "sm")}>{connectLabel}</a>
                )}
                {canConnect && !c.methods.oauth && !isOpen && <Button size="sm" variant="primary" data-testid="connector-connect" onClick={() => setOpen(c.id)}>{connectLabel}</Button>}
                {isOpen && <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>}
                {(c.status === "connected" || c.status === "expired" || c.status === "revoked") && (
                  <ConfirmButton label="Disconnect" question={`Disconnect ${c.name}?`} confirmLabel="Disconnect" testId="connector-disconnect" onConfirm={() => disconnect(c)} />
                )}
              </div>
            </div>

            {isOpen && c.apiKey && (
              <form data-testid="connector-permissions" className="mt-3" onSubmit={(e) => { e.preventDefault(); saveKey(c); }}>
                <label htmlFor={`key-${c.id}`} className="sr-only">{c.apiKey.label}</label>
                <div className="flex gap-2">
                  <input id={`key-${c.id}`} data-testid="connector-key" type="password" autoComplete="off" spellCheck={false}
                    value={keys[c.id] ?? ""} placeholder={c.apiKey.label} maxLength={500}
                    onChange={(e) => setKeys((k) => ({ ...k, [c.id]: e.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
                  <Button type="submit" size="sm" variant="primary" data-testid="connector-save" disabled={busy === c.id}>{busy === c.id ? "…" : "Save"}</Button>
                </div>
                <a href={c.apiKey.helpUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-accent-strong underline">Get token</a>
              </form>
            )}
            {errors[c.id] && <p role="alert" className="mt-2 text-xs text-danger">{errors[c.id]}</p>}
          </article>
        );
      })}
    </div>
  );
}
