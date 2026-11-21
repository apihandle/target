"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * The NVIDIA card on /app/connectors: the signed-in user's own NVIDIA API key (build.nvidia.com),
 * stored sealed per user (social_ai_keys, migration 0027) exactly like a custom provider key, via
 * the user-level routes /api/social/key (+ /test) with provider: "nvidia". When this key is saved
 * it is the one that writes social drafts and Blogger autopilot posts — the Gemini key (card below)
 * is the fallback. The key is entered here in the app only — never via chat or env — and only its
 * masked preview is ever shown again. "Test key" checks a pasted key with NVIDIA without saving
 * it; Save stores it; Clear removes it.
 */
type KeyStatus = { saved: boolean; preview: string; model: string | null };

async function call(url: string, method: string, body?: Record<string, unknown>): Promise<{ res: Response; j: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, j };
}

export default function NvidiaKeyCard() {
  const [nvidia, setNvidia] = useState<KeyStatus | null>(null);
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
        const j = (await r.json().catch(() => ({}))) as { nvidia?: KeyStatus };
        if (live && r.ok && j.nvidia) { setNvidia(j.nvidia); setModelInput(j.nvidia.model ?? ""); }
        else if (live) setNvidia({ saved: false, preview: "", model: null });
      } catch { if (live) setNvidia({ saved: false, preview: "", model: null }); }
    })();
    return () => { live = false; };
  }, []);

  const test = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key/test", "POST", { provider: "nvidia", apiKey: keyInput });
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "The key test failed." });
      else setNote({ ok: true, text: "NVIDIA accepts this key. Save it to use it for drafts and autopilot posts." });
    } catch { setNote({ ok: false, text: "Network error. The key was not tested." }); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key", "POST", { provider: "nvidia", apiKey: keyInput, model: modelInput.trim() || undefined });
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "Could not save the key." });
      else {
        const n = j.nvidia as KeyStatus;
        setNvidia(n); setKeyInput("");
        setNote({ ok: true, text: `Key saved. Only the preview ${n.preview} is ever shown.` });
      }
    } catch { setNote({ ok: false, text: "Network error. The key was not saved." }); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setNote(null);
    try {
      const { res, j } = await call("/api/social/key?provider=nvidia", "DELETE");
      if (!res.ok) setNote({ ok: false, text: typeof j.error === "string" ? j.error : "Could not remove the key." });
      else { setNvidia({ saved: false, preview: "", model: null }); setModelInput(""); setNote({ ok: true, text: "Key removed." }); }
    } catch { setNote({ ok: false, text: "Network error. The key was not removed." }); }
    finally { setBusy(false); setConfirmClear(false); }
  };

  if (!nvidia) return null;

  return (
    <section data-testid="nvidia-card" aria-label="NVIDIA API key"
      className="mt-4 rounded-xl2 border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-ink">NVIDIA API key</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${nvidia.saved ? "border-ok/30 bg-ok-subtle text-ok" : "border-line-strong bg-surface-2 text-muted"}`}>
          {nvidia.saved ? `Saved · ${nvidia.preview}` : "Not saved"}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Your own NVIDIA key from build.nvidia.com. When it is saved, TARGET writes your social drafts
        and Blogger autopilot posts with NVIDIA — the Gemini key below is only the fallback. It is
        stored encrypted, tied to your account — the same way TARGET stores every provider key — and
        only this masked preview is ever shown again.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px]">
        <label className="sr-only" htmlFor="nvidia-key-input">NVIDIA API key</label>
        <input id="nvidia-key-input" data-testid="nvidia-key-input" type="password" autoComplete="off" spellCheck={false}
          value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
          placeholder={nvidia.saved ? "Paste a new key to replace the saved one" : "Paste your NVIDIA API key"}
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
        <label className="sr-only" htmlFor="nvidia-key-model">NVIDIA model (optional)</label>
        <input id="nvidia-key-model" data-testid="nvidia-key-model"
          value={modelInput} onChange={(e) => setModelInput(e.target.value)}
          placeholder="Model (optional, e.g. meta/llama-3.3-70b-instruct)"
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" data-testid="nvidia-key-test" disabled={busy || !keyInput.trim()} onClick={() => void test()}>
          {busy ? "…" : "Test key"}
        </Button>
        <Button size="sm" variant="primary" data-testid="nvidia-key-save" disabled={busy || !keyInput.trim()} onClick={() => void save()}>
          {nvidia.saved ? "Replace key" : "Save key"}
        </Button>
        {nvidia.saved && !confirmClear && (
          <Button size="sm" variant="ghost" data-testid="nvidia-key-clear" disabled={busy} onClick={() => setConfirmClear(true)}>Clear key</Button>
        )}
        {nvidia.saved && confirmClear && (
          <>
            <span className="text-xs text-muted">Remove the saved key?</span>
            <Button size="sm" variant="primary" data-testid="nvidia-key-clear-confirm" disabled={busy} onClick={() => void clear()}>Yes, remove</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>Keep it</Button>
          </>
        )}
        {note && <span role="status" className={`text-xs ${note.ok ? "text-ok" : "text-danger"}`}>{note.text}</span>}
      </div>
    </section>
  );
}
