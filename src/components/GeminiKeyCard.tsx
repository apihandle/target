"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * The Gemini card on /app/connectors: the signed-in user's own Gemini API key for social drafting,
 * stored sealed per user (social_ai_keys, migration 0023) exactly like a custom provider key, via
 * the user-level routes /api/social/key (+ /test). The key is entered here in the app only — never
 * via chat or env — and only its masked preview is ever shown again. "Test key" checks a pasted key
 * with Google without saving it; Save stores it; Clear removes it.
 */
type GeminiStatus = { saved: boolean; preview: string; model: string | null };

async function call(url: string, method: string, body?: Record<string, unknown>): Promise<{ res: Response; j: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, j };
}

export default function GeminiKeyCard() {
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/social/key", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { gemini?: GeminiStatus };
        if (live && r.ok && j.gemini) { setGemini(j.gemini); setModelInput(j.gemini.model ?? ""); }
        else if (live) setGemini({ saved: false, preview: "", model: null });
      } catch { if (live) setGemini({ saved: false, preview: "", model: null }); }
    })();
    return () => { live = false; };
  }, []);

  const test = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key/test", "POST", { apiKey: keyInput });
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "The key test failed." });
      else setNote({ ok: true, text: "Google accepts this key. Save it to use it for drafts." });
    } catch { setNote({ ok: false, text: "Network error. The key was not tested." }); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key", "POST", { apiKey: keyInput, model: modelInput.trim() || undefined });
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "Could not save the key." });
      else {
        const g = j.gemini as GeminiStatus;
        setGemini(g); setKeyInput("");
        setNote({ ok: true, text: `Key saved. Only the preview ${g.preview} is ever shown.` });
      }
    } catch { setNote({ ok: false, text: "Network error. The key was not saved." }); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key", "DELETE");
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "Could not remove the key." });
      else { setGemini({ saved: false, preview: "", model: null }); setModelInput(""); setNote({ ok: true, text: "Key removed." }); }
    } catch { setNote({ ok: false, text: "Network error. The key was not removed." }); }
    finally { setBusy(false); setConfirmClear(false); }
  };

  if (!gemini) return null;

  return (
    <section data-testid="gemini-card" aria-label="Gemini API key"
      className="mt-4 rounded-xl2 border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-ink">Gemini API key</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${gemini.saved ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>
          {gemini.saved ? `Saved · ${gemini.preview}` : "Not saved"}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Your own Gemini key from Google AI Studio, used to draft social posts when you ask. It is stored
        encrypted, tied to your account — the same way TARGET stores every provider key — and only this
        masked preview is ever shown again.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px]">
        <label className="sr-only" htmlFor="gemini-key-input">Gemini API key</label>
        <input id="gemini-key-input" data-testid="gemini-key-input" type="password" autoComplete="off" spellCheck={false}
          value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
          placeholder={gemini.saved ? "Paste a new key to replace the saved one" : "Paste your Gemini API key"}
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
        <label className="sr-only" htmlFor="gemini-key-model">Gemini model (optional)</label>
        <input id="gemini-key-model" data-testid="gemini-key-model"
          value={modelInput} onChange={(e) => setModelInput(e.target.value)}
          placeholder="Model (optional, e.g. gemini-2.5-flash)"
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" data-testid="gemini-key-test" disabled={busy || !keyInput.trim()} onClick={() => void test()}>
          {busy ? "…" : "Test key"}
        </Button>
        <Button size="sm" variant="primary" data-testid="gemini-key-save" disabled={busy || !keyInput.trim()} onClick={() => void save()}>
          {gemini.saved ? "Replace key" : "Save key"}
        </Button>
        {gemini.saved && !confirmClear && (
          <Button size="sm" variant="ghost" data-testid="gemini-key-clear" disabled={busy} onClick={() => setConfirmClear(true)}>Clear key</Button>
        )}
        {gemini.saved && confirmClear && (
          <>
            <span className="text-xs text-muted">Remove the saved key?</span>
            <Button size="sm" variant="primary" data-testid="gemini-key-clear-confirm" disabled={busy} onClick={() => void clear()}>Yes, remove</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Keep it</Button>
          </>
        )}
        {note && <span role="status" className={`text-xs ${note.ok ? "text-ok" : "text-danger"}`}>{note.text}</span>}
      </div>
    </section>
  );
}
