"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";

type Provider = { id: string; name: string; base_url: string; models: string[]; key_preview: string; created_at: string; updated_at: string };
type Form = { id: string | null; name: string; baseUrl: string; apiKey: string; models: string[]; modelInput: string };
const EMPTY: Form = { id: null, name: "", baseUrl: "", apiKey: "", models: [], modelInput: "" };
const MODEL_RE = /^[\w.:/@+\-]{1,150}$/;

async function post(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  return { ok: !!r?.ok, j: (j ?? {}) as Record<string, unknown> };
}

/**
 * Settings → AI providers: the user's own OpenAI-compatible endpoints. The key goes to the server once, is
 * stored encrypted and is never shown again (only a masked preview). Models added here appear in the chat's
 * model picker; picking one sends that chat only to this provider.
 */
export default function CustomProviders() {
  const [items, setItems] = useState<Provider[] | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "fetch" | "test">("");
  const [fetched, setFetched] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testModel, setTestModel] = useState("");

  const load = async () => {
    const r = await fetch("/api/custom-providers", { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) setError(j?.error ?? "Couldn't load your providers");
    setItems(j?.providers ?? []);
  };
  useEffect(() => { load(); }, []);

  const editing = f.id ? items?.find((p) => p.id === f.id) : undefined;
  const set = (k: "name" | "baseUrl" | "apiKey" | "modelInput") => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const reset = () => { setF(EMPTY); setOpen(false); setError(""); setField(""); setFetched([]); setTest(null); setTestModel(""); };
  const startEdit = (p: Provider) => { setF({ id: p.id, name: p.name, baseUrl: p.base_url, apiKey: "", models: p.models, modelInput: "" }); setOpen(true); setError(""); setField(""); setFetched([]); setTest(null); setTestModel(p.models[0] ?? ""); };

  function addModels(ids: string[]) {
    setF((x) => {
      const next = [...x.models];
      for (const raw of ids) { const m = raw.trim(); if (m && MODEL_RE.test(m) && !next.includes(m) && next.length < 20) next.push(m); }
      return { ...x, models: next, modelInput: "" };
    });
  }
  function addTyped() {
    const parts = f.modelInput.split(/[\s,]+/).filter(Boolean);
    const badOne = parts.find((m) => !MODEL_RE.test(m));
    if (badOne) { setError(`“${badOne.slice(0, 40)}” isn't a valid model id`); setField("models"); return; }
    setError(""); addModels(parts);
    if (!testModel && parts[0]) setTestModel(parts[0]);
  }
  const removeModel = (m: string) => setF((x) => ({ ...x, models: x.models.filter((y) => y !== m) }));

  // For Fetch models / Test connection: the form's URL + key, or the saved provider's key when the key field is empty.
  const target = () => ({ ...(f.id ? { id: f.id } : {}), name: f.name, baseUrl: f.baseUrl, ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}) });

  async function fetchModels() {
    setBusy("fetch"); setError(""); setField("");
    const { ok, j } = await post("/api/custom-providers/models", target());
    setBusy("");
    if (!ok) { setError(String(j.error ?? "Couldn't fetch models")); return; }
    const list = (j.models as string[]) ?? [];
    setFetched(list);
    if (!list.length) setError("The provider returned no models. Type the model id instead.");
  }
  async function runTest() {
    setBusy("test"); setTest(null); setError("");
    const model = testModel || f.models[0] || "";
    const { j } = await post("/api/custom-providers/test", { ...target(), ...(model ? { model } : {}) });
    setBusy("");
    setTest({ ok: j.ok === true, message: String(j.message ?? j.error ?? "Test failed") });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.modelInput.trim()) { addTyped(); return; }
    setBusy("save"); setError(""); setField("");
    const body: Record<string, unknown> = { name: f.name, baseUrl: f.baseUrl, models: f.models };
    if (f.apiKey.trim()) body.apiKey = f.apiKey.trim();
    const { ok, j } = f.id ? await post(`/api/custom-providers/${f.id}`, body, "PATCH") : await post("/api/custom-providers", body);
    setBusy("");
    if (!ok) { setError(String(j.error ?? "Couldn't save")); setField(String(j.field ?? "")); return; }
    reset(); load();
  }
  async function del(p: Provider) {
    if (!confirm(`Delete “${p.name}”? Its models leave the model picker.`)) return;
    await fetch(`/api/custom-providers/${p.id}`, { method: "DELETE" }).catch(() => null);
    if (f.id === p.id) reset();
    load();
  }

  const err = (k: string) => (field === k ? error : undefined);
  return (
    <div className="space-y-6" data-testid="custom-providers">
      <p className="text-sm text-muted">Use your own OpenAI-compatible API (OpenAI, Groq, Together, DeepInfra, your own server…). Pick its model in the chat&apos;s model picker; that chat then uses only your provider.</p>

      {!open ? (
        <Button variant="primary" onClick={() => { setF(EMPTY); setOpen(true); }} data-testid="cp-add">Add provider</Button>
      ) : (
        <form onSubmit={save} autoComplete="off" className="space-y-4 rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur" data-testid="cp-form">
          <p className="text-sm font-medium text-ink">{f.id ? `Edit ${editing?.name ?? "provider"}` : "New provider"}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cp-name" label="Name" error={err("name")}><input value={f.name} onChange={set("name")} maxLength={60} required placeholder="My Groq" className={inputClass} /></Field>
            <Field id="cp-url" label="Base URL" hint="Usually ends in /v1" error={err("baseUrl")}><input value={f.baseUrl} onChange={set("baseUrl")} required inputMode="url" placeholder="https://api.groq.com/openai/v1" className={inputClass} /></Field>
          </div>
          <Field id="cp-key" label="API key" optional={!!f.id} hint={f.id ? `Saved: ${editing?.key_preview ?? "••••"}. Leave empty to keep it.` : "Encrypted on the server. TARGET never shows it again."} error={err("apiKey")}>
            <input type="password" value={f.apiKey} onChange={set("apiKey")} required={!f.id} autoComplete="new-password" placeholder={f.id ? "Leave empty to keep the saved key" : "sk-…"} className={inputClass} />
          </Field>

          <div className="space-y-2">
            <Field id="cp-model" label="Models" hint="Type a model id and press Add, or fetch the list from the provider." error={err("models")}>
              <input value={f.modelInput} onChange={set("modelInput")} placeholder="llama-3.3-70b-versatile" className={inputClass}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={addTyped} disabled={!f.modelInput.trim()}>Add</Button>
              <Button size="sm" onClick={fetchModels} disabled={!!busy || !f.baseUrl.trim() || (!f.id && !f.apiKey.trim())} data-testid="cp-fetch">{busy === "fetch" ? "Fetching…" : "Fetch models"}</Button>
            </div>
            {f.models.length > 0 && (
              <ul className="flex flex-wrap gap-2" data-testid="cp-models">
                {f.models.map((m) => (
                  <li key={m} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-strong bg-surface-2 py-1 pl-3 pr-1 text-xs text-ink-soft">
                    <span className="truncate">{m}</span>
                    <button type="button" aria-label={`Remove ${m}`} onClick={() => removeModel(m)} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink">×</button>
                  </li>
                ))}
              </ul>
            )}
            {fetched.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-line bg-bg p-2" data-testid="cp-fetched">
                <p className="px-1 pb-1 text-xs text-muted">{fetched.length} model{fetched.length === 1 ? "" : "s"} found. Tap to add.</p>
                <div className="flex flex-wrap gap-1.5">
                  {fetched.map((m) => (
                    <button key={m} type="button" onClick={() => { addModels([m]); if (!testModel) setTestModel(m); }} disabled={f.models.includes(m)}
                      className="max-w-full truncate rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-40">{m}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {f.models.length > 1 && (
              <select aria-label="Model to test" value={testModel || f.models[0]} onChange={(e) => setTestModel(e.target.value)} className="h-8 max-w-[12rem] truncate rounded-full border border-line-strong bg-surface px-2 text-xs text-ink-soft">
                {f.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <Button size="sm" onClick={runTest} disabled={!!busy || !f.baseUrl.trim() || (!f.id && !f.apiKey.trim())} data-testid="cp-test">{busy === "test" ? "Testing…" : "Test connection"}</Button>
            {test && <p data-testid="cp-test-result" className={`text-xs ${test.ok ? "text-ok" : "text-danger"}`}>{test.message}</p>}
          </div>

          {error && !field && <p className="text-sm text-danger" data-testid="cp-error">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={reset}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!!busy || !f.models.length} data-testid="cp-save">{busy === "save" ? "Saving…" : "Save provider"}</Button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {items === null ? <p className="text-sm text-muted">Loading…</p> : !items.length ? <p className="text-sm text-muted">No providers yet.</p> : items.map((p) => (
          <article key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 p-4" data-testid="cp-item">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name} <span className="text-xs font-normal text-muted">· {p.models.length} model{p.models.length === 1 ? "" : "s"}</span></p>
              <p className="mt-1 truncate text-xs text-muted-soft">{p.base_url} · {p.key_preview}</p>
            </div>
            <Button size="sm" onClick={() => startEdit(p)}>Edit</Button>
            <Button size="sm" variant="danger" onClick={() => del(p)}>Delete</Button>
          </article>
        ))}
      </div>
    </div>
  );
}
