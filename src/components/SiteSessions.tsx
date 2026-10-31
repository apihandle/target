"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Row = { id: string; domain: string; account_email: string; via: string; cookie_count: number; status: string; expires_at: string; updated_at: string; last_used_at: string | null };

const VIA: Record<string, string> = { google: "Joined with Google", email: "Email sign-in", password: "Password sign-in", other: "Signed in" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function SiteSessions({ google }: { google: { status: string; email: string } | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const r = await fetch("/api/site-sessions", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Couldn't load saved sign-ins"); setRows([]); return; }
    setRows(j.sessions ?? []);
  }
  useEffect(() => { load(); }, []);

  async function signOut(id: string | "all" | "expired") {
    if (id === "all" && !confirm("Sign TARGET out of every website?")) return;
    setBusy(id);
    const url = id === "all" ? "/api/site-sessions?all=1" : id === "expired" ? "/api/site-sessions?expired=1" : `/api/site-sessions?id=${id}`;
    const r = await fetch(url, { method: "DELETE" });
    setBusy("");
    if (!r.ok) { setError("Couldn't sign out. Try again."); return; }
    await load();
  }

  if (rows === null) return <p className="px-1 text-sm text-muted">Loading…</p>;
  const now = Date.now();
  const expiredCount = rows.filter((s) => s.status !== "active" || Date.parse(s.expires_at) <= now).length;
  const gOk = google?.status === "connected";
  return (
    <div className="space-y-3" data-testid="site-sessions">
      <article data-testid="google-health" className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-surface/70 p-4 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Google account</h3>
            <Badge tone={gOk ? "ok" : "warn"}>{gOk ? "Connected" : google ? "Needs reconnect" : "Not connected"}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted">{google?.email || "Link Google so TARGET can read sign-up codes from your Gmail."}</p>
        </div>
        {!gOk && <a href="/app/connectors" className="rounded-full border border-accent/60 px-3 py-1.5 text-sm text-accent" data-testid="google-reconnect">{google ? "Reconnect" : "Connect"}</a>}
      </article>
      {error && <p className="rounded-2xl border border-danger/30 px-4 py-3 text-sm text-danger">{error}</p>}
      {!rows.length ? (
        <p className="rounded-2xl border border-line bg-surface/70 px-4 py-5 text-sm text-muted" data-testid="sessions-empty">
          No saved sign-ins yet. When TARGET signs in to or joins a website for you, the sign-in is kept here, locked and encrypted.
        </p>
      ) : (
        <>
          {rows.map((s) => {
            const live = s.status === "active" && Date.parse(s.expires_at) > now;
            return (
              <article key={s.id} data-testid="site-session" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/70 p-4 backdrop-blur">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-medium">{s.domain}</h3>
                    <Badge tone={live ? "ok" : "warn"}>{live ? "Signed in" : "Expired"}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{VIA[s.via] ?? "Signed in"}{s.account_email ? ` · ${s.account_email}` : ""}</p>
                  <p className="mt-0.5 text-xs text-muted-soft">{live ? `Valid until ${fmt(s.expires_at)}` : "Sign in again to use it"}{s.last_used_at ? ` · last used ${fmt(s.last_used_at)}` : ""}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => signOut(s.id)} data-testid="session-signout">Sign out</Button>
              </article>
            );
          })}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {expiredCount > 0 && <Button size="sm" variant="ghost" disabled={busy === "expired"} onClick={() => signOut("expired")} data-testid="sessions-clear-expired">Clear expired ({expiredCount})</Button>}
            <Button size="sm" variant="danger" disabled={busy === "all"} onClick={() => signOut("all")} data-testid="sessions-signout-all">Sign out everywhere</Button>
          </div>
        </>
      )}
      <p className="px-1 text-xs leading-relaxed text-muted-soft">
        Sign-in cookies are encrypted on the server and never shown in the app or to the AI. They only work for the website they came from.
        Disconnecting Google also signs TARGET out of every website joined with that Gmail.
      </p>
    </div>
  );
}
