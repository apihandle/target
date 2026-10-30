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
    <div className="mt-8 grid gap-4 sm:grid-cols-2" data-testid="connectors-grid">
      {items.map((c) => {
        const [label, tone] = STATUS[c.status];
        const canConnect = c.status !== "setup_required" && c.status !== "connected";
        const isOpen = open === c.id && canConnect;
        return (
          <article key={c.id} ref={c.id === focus ? (el) => { focusRef.current = el; } : undefined}
            data-testid="connector-card" data-id={c.id} data-status={c.status} aria-label={c.name}
            className={`flex flex-col rounded-xl2 border bg-surface p-4 shadow-card sm:p-5 ${c.id === focus ? "border-accent/60" : "border-line"}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-subtle text-sm font-black text-accent">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium text-ink">{c.name}</h2>
                  <Badge tone={tone} data-testid="connector-status">{label}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{c.description}</p>
                {c.accountLabel && c.status === "connected" && <p className="mt-1 text-xs text-ink-soft">Account: {c.accountLabel}</p>}
              </div>
            </div>

            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-soft">What the agent can do</p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                {c.capabilities.map((x) => <li key={x}>• {x}</li>)}
              </ul>
            </div>

            {isOpen && (
              <div data-testid="connector-permissions" className="mt-4 rounded-xl border border-line-strong bg-surface-2 p-3 text-xs">
                <p className="font-medium text-ink">Before you connect</p>
                <ul className="mt-1.5 space-y-1 text-muted">{c.permissions.map((p) => <li key={p}>• {p}</li>)}</ul>
                {c.scopes.length > 0 && <p className="mt-2 text-[11px] text-muted-soft">{c.methods.oauth ? "Permissions requested" : "Token permissions to grant"}: {c.scopes.join(", ")}</p>}
                <p className="mt-2 text-muted">Actions marked “asks you first” never run until you press Approve. Text from this app is treated as data, never as instructions.</p>
                {c.methods.oauth && (
                  <a href={oauthHref(c)} data-testid="connector-oauth" className={buttonClass("primary", "sm", "mt-3")}>Continue to {c.name}</a>
                )}
                {c.methods.apiKey && c.apiKey && (
                  <form className="mt-3" onSubmit={(e) => { e.preventDefault(); saveKey(c); }}>
                    {c.methods.oauth && <p className="mb-2 text-muted-soft">Or paste a token instead:</p>}
                    <label htmlFor={`key-${c.id}`} className="block font-medium text-ink-soft">{c.apiKey.label}</label>
                    <p className="mt-0.5 text-muted">{c.apiKey.helpText} <a href={c.apiKey.helpUrl} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline">Open {c.name}</a></p>
                    <input id={`key-${c.id}`} data-testid="connector-key" type="password" autoComplete="off" spellCheck={false}
                      value={keys[c.id] ?? ""} placeholder={c.apiKey.placeholder} maxLength={500}
                      onChange={(e) => setKeys((k) => ({ ...k, [c.id]: e.target.value }))}
                      className="mt-2 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
                    <Button type="submit" size="sm" variant="primary" className="mt-2" data-testid="connector-save" disabled={busy === c.id}>{busy === c.id ? "Checking…" : "Verify & connect"}</Button>
                  </form>
                )}
              </div>
            )}

            {c.status === "setup_required" && (
              <p data-testid="connector-setup" className="mt-3 rounded-lg bg-warn-subtle px-3 py-2 text-xs text-warn">
                The site owner needs to add: {c.missingEnv.map((e, n) => <span key={e}>{n > 0 && ", "}<code>{e}</code></span>)}.
              </p>
            )}
            {errors[c.id] && <p role="alert" className="mt-2 text-xs text-danger">{errors[c.id]}</p>}

            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              {canConnect && !isOpen && <Button size="sm" variant="primary" data-testid="connector-connect" onClick={() => setOpen(c.id)}>{c.status === "expired" || c.status === "revoked" ? "Reconnect" : "Connect"}</Button>}
              {isOpen && <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>}
              {(c.status === "connected" || c.status === "expired" || c.status === "revoked") && (
                <ConfirmButton label="Disconnect" question={`Disconnect ${c.name}? The agent loses its tools.`} confirmLabel="Disconnect" testId="connector-disconnect" onConfirm={() => disconnect(c)} />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
