"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";

type Item = { id: string; kind: string; label: string; site: string | null; preview: string; last_used_at: string | null; created_at: string };
const KIND_TEXT: Record<string, string> = { login: "Login", card: "Card", api_key: "API key", note: "Secure note" };
const EMPTY = { kind: "login", label: "", site: "", username: "", password: "", name: "", number: "", expiry: "", cvc: "", value: "" };

/** Save logins, cards and keys. Values go to the server once and are never shown again. */
export default function VaultManager() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { const r = await fetch("/api/vault", { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) setError(j.error ?? "Couldn't load your vault"); setItems(j.items ?? []); };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; state is set from the async fetch result
  useEffect(() => { load(); }, []);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const pick: Record<string, string[]> = { login: ["site", "username", "password"], card: ["name", "number", "expiry", "cvc"], api_key: ["site", "value"], note: ["value"] };
    const body: Record<string, string> = { kind: f.kind, label: f.label };
    for (const k of pick[f.kind]) if (f[k as keyof typeof EMPTY]) body[k] = f[k as keyof typeof EMPTY];
    const r = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r?.ok) { setError(j?.error ?? "Couldn't save"); return; }
    setF({ ...EMPTY, kind: f.kind }); load();
  }
  async function del(id: string) { if (!confirm("Delete this item from your vault?")) return; await fetch(`/api/vault/${id}`, { method: "DELETE" }); load(); }

  return (
    <div className="space-y-6" data-testid="vault">
      <form onSubmit={save} autoComplete="off" className="space-y-4 rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="v-kind" label="Type"><select value={f.kind} onChange={set("kind")} className={inputClass}>{Object.entries(KIND_TEXT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
          <Field id="v-label" label="Name"><input value={f.label} onChange={set("label")} maxLength={80} required placeholder={f.kind === "card" ? "HDFC debit" : "Amazon"} className={inputClass} /></Field>
        </div>
        {f.kind === "login" && <div className="grid gap-4 sm:grid-cols-3">
          <Field id="v-site" label="Website" optional><input value={f.site} onChange={set("site")} placeholder="amazon.in" className={inputClass} /></Field>
          <Field id="v-user" label="Email or username"><input value={f.username} onChange={set("username")} required autoComplete="off" className={inputClass} /></Field>
          <Field id="v-pass" label="Password"><input type="password" value={f.password} onChange={set("password")} required autoComplete="new-password" className={inputClass} /></Field>
        </div>}
        {f.kind === "card" && <div className="grid gap-4 sm:grid-cols-4">
          <Field id="v-name" label="Name on card" optional><input value={f.name} onChange={set("name")} className={inputClass} /></Field>
          <Field id="v-num" label="Card number"><input inputMode="numeric" value={f.number} onChange={set("number")} required autoComplete="off" className={inputClass} /></Field>
          <Field id="v-exp" label="Expiry (MM/YY)"><input value={f.expiry} onChange={set("expiry")} required placeholder="08/29" className={inputClass} /></Field>
          <Field id="v-cvc" label="CVV" optional><input type="password" inputMode="numeric" value={f.cvc} onChange={set("cvc")} maxLength={4} autoComplete="off" className={inputClass} /></Field>
        </div>}
        {(f.kind === "api_key" || f.kind === "note") && <div className="grid gap-4 sm:grid-cols-2">
          {f.kind === "api_key" && <Field id="v-site2" label="Service" optional><input value={f.site} onChange={set("site")} placeholder="openai.com" className={inputClass} /></Field>}
          <Field id="v-val" label={f.kind === "note" ? "Note" : "Key"}><input type="password" value={f.value} onChange={set("value")} required autoComplete="off" className={inputClass} /></Field>
        </div>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Encrypted on the server. TARGET never shows it again, and the AI only sees the name.</p>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save to vault"}</Button>
        </div>
      </form>
      <div className="space-y-3">
        {items === null ? <p className="text-sm text-muted">Loading…</p> : !items.length ? <p className="text-sm text-muted">Your vault is empty.</p> : items.map((i) => (
          <article key={i.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{i.label} <span className="text-xs font-normal text-muted">· {KIND_TEXT[i.kind] ?? i.kind}</span></p>
              <p className="mt-1 truncate text-xs text-muted-soft">{[i.site, i.preview].filter(Boolean).join(" · ") || "Saved"}{i.last_used_at ? ` · used ${new Date(i.last_used_at).toLocaleDateString("en-IN")}` : ""}</p>
            </div>
            <Button size="sm" variant="danger" onClick={() => del(i.id)}>Delete</Button>
          </article>
        ))}
      </div>
    </div>
  );
}
