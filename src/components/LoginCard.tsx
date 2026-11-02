"use client";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

/** Ask the chat to continue (Chat listens for this event and sends it as the user's next message). */
export function continueInChat(text: string) {
  window.dispatchEvent(new CustomEvent("target:send", { detail: { text } }));
}

/**
 * Secure form shown in chat when TARGET needs a website login. The password goes straight to the
 * encrypted vault and never into the conversation or the AI's context.
 */
export default function LoginCard({ site, forSite }: { site: string; forSite?: string }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState("");
  const target = forSite ?? site;
  const google = site === "google.com" && !!forSite;
  useEffect(() => {
    fetch("/api/vault").then((r) => r.json()).then((j) => {
      const has = (j.items ?? []).some((i: { kind: string; site: string | null }) => i.kind === "login" && (i.site ?? "").replace(/^www\./, "") === site);
      if (has) setState("saved");
    }).catch(() => undefined);
  }, [site]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("busy"); setError("");
    const r = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "login", label: site, site, username: user, password: pass }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState("idle"); setError(j.error ?? "Couldn't save"); return; }
    setPass(""); setState("saved");
    continueInChat(google ? `Google login saved. Ab ${target} pe Google se sign in karo.` : `Login saved. Ab ${target} pe sign in karo.`);
  }

  if (state === "saved") return (
    <section data-testid="login-card" data-site={site} className="not-prose mt-3 rounded-xl border border-line-strong bg-surface px-4 py-3 text-xs text-muted">
      <p className="font-medium text-ink-soft">✓ Login for {site} is saved in your vault</p>
      <button type="button" data-testid="login-continue" onClick={() => continueInChat(google ? `Ab ${target} pe Google se sign in karo.` : `Ab ${target} pe sign in karo.`)} className={buttonClass("secondary", "sm", "mt-2")}>Sign in now</button>
    </section>
  );
  return (
    <form onSubmit={save} autoComplete="off" data-testid="login-card" data-site={site} className="not-prose mt-3 space-y-2 rounded-xl border border-accent/40 bg-surface p-4 text-sm">
      <p className="font-medium text-ink">{google ? `Google account for ${target}` : `Your ${site} login`}</p>
      <input aria-label="Email or username" data-testid="login-user" value={user} onChange={(e) => setUser(e.target.value)} required maxLength={200} autoComplete="off" placeholder="Email or username" className={inputClass} />
      <input aria-label="Password" data-testid="login-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} required maxLength={500} autoComplete="new-password" placeholder="Password" className={inputClass} />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" data-testid="login-save" disabled={state === "busy"} className={buttonClass("primary", "sm")}>{state === "busy" ? "Saving…" : "Save & sign in"}</button>
        <span className="text-[11px] text-muted">Encrypted in your vault. Never shown in chat.</span>
      </div>
    </form>
  );
}
