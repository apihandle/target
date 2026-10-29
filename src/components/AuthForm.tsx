"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateCredentials } from "@/lib/validate";
import GoogleButton from "./GoogleButton";

type Mode = "signin" | "signup";

export default function AuthForm({ initialEmail = "", next = "/app" }: { initialEmail?: string; next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialEmail ? "signup" : "signin");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const invalid = validateCredentials(email, password);
    if (invalid) return setError(invalid);
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) return setError(error.message);
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setInfo("Check your inbox to confirm your email, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return setError(error.message);
        router.push(next);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl">
      <div className="mb-5 grid grid-cols-2 rounded-full bg-black/30 p-1 text-sm">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`tab-${m}`}
            onClick={() => { setMode(m); setError(null); setInfo(null); }}
            className={`rounded-full py-2 font-semibold transition ${mode === m ? "bg-white text-black" : "text-white/60"}`}
          >
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>
      <GoogleButton next={next} />
      <div className="my-4 flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <input
          data-testid="auth-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-full border border-white/15 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-orange-400"
        />
        <input
          data-testid="auth-password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-full border border-white/15 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-orange-400"
        />
        <button
          data-testid="auth-submit"
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-gradient-to-r from-orange-500 to-rose-600 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      {error && <p data-testid="auth-error" className="mt-3 text-center text-xs text-rose-400">{error}</p>}
      {info && <p data-testid="auth-info" className="mt-3 text-center text-xs text-emerald-400">{info}</p>}
    </div>
  );
}
