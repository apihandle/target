"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateCredentials } from "@/lib/validate";
import GoogleButton from "./GoogleButton";

type Mode = "signin" | "signup";

/**
 * Venice-style auth card: cream card, centered heading, social button, "or" divider,
 * labelled inputs, full-width blue Continue, and a footer band that switches mode.
 */
export default function AuthForm({ initialEmail = "", next = "/app", initialMode }: { initialEmail?: string; next?: string; initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialEmail ? "signup" : "signin"));
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchTo(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

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

  const input =
    "h-9 w-full rounded-[6px] border border-[#e0ded9] bg-[#f3f2f0] px-3 text-[14px] text-[#1a1a1a] outline-none transition placeholder:text-[#6b6b6b] focus:border-[#2168b0] focus:ring-2 focus:ring-[#2168b0]/20";

  return (
    <div className="w-full max-w-[448px] overflow-hidden rounded-[12px] border border-[#e5e3df] bg-[#fdfcf9] text-[#1a1a1a] shadow-[0_5px_15px_rgba(0,0,0,0.08),0_15px_35px_-5px_rgba(25,28,33,0.12)]">
      <div className="px-6 pb-8 pt-8 sm:px-10">
        <div className="text-center">
          <Link href="/" aria-label="TARGET home" className="font-script text-[44px] leading-none text-[#1a1a1a]">Target</Link>
          <h1 className="mt-3 text-[18px] font-bold leading-tight">
            {mode === "signin" ? "Sign in to your Target account" : "Create your Target account"}
          </h1>
        </div>

        <div className="mt-6">
          <GoogleButton next={next} variant="light" />
        </div>

        <div className="my-5 flex items-center gap-4 text-[13px] text-[#666]">
          <span className="h-px flex-1 bg-[#e5e3df]" /> or <span className="h-px flex-1 bg-[#e5e3df]" />
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium">Email address</span>
            <input
              data-testid="auth-email"
              type="email"
              autoComplete="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-medium">Password</span>
            <span className="relative block">
              <input
                data-testid="auth-password"
                type={showPw ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={mode === "signup" ? "Create a password" : "Enter your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${input} pr-10`}
              />
              <button
                type="button"
                aria-label={showPw ? "Hide password" : "Show password"}
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-[#6b6b6b] hover:text-[#1a1a1a]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPw && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </span>
          </label>
          <button
            data-testid="auth-submit"
            type="submit"
            disabled={loading}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[6px] bg-gradient-to-b from-[#2168b0] to-[#1a5a9a] text-[14px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:from-[#1d5f9f] hover:to-[#164f88] disabled:opacity-60"
          >
            {loading ? "Please wait…" : "Continue"}
            {!loading && <span aria-hidden="true" className="text-[10px]">▶</span>}
          </button>
        </form>
        {error && <p data-testid="auth-error" className="mt-3 text-center text-[13px] text-rose-600">{error}</p>}
        {info && <p data-testid="auth-info" className="mt-3 text-center text-[13px] text-emerald-700">{info}</p>}
      </div>

      <div className="space-y-1 border-t border-[#e5e3df] bg-[#f5f3ef] px-6 py-5 text-center text-[14px] text-[#555]">
        {mode === "signin" ? (
          <p>
            Don&apos;t have an account?{" "}
            <button type="button" data-testid="tab-signup" onClick={() => switchTo("signup")} className="font-medium text-[#222] underline underline-offset-2">
              Create one here
            </button>
            .
          </p>
        ) : (
          <p>
            Already have an account?{" "}
            <button type="button" data-testid="tab-signin" onClick={() => switchTo("signin")} className="font-medium text-[#222] underline underline-offset-2">
              Sign in here
            </button>
            .
          </p>
        )}
        <p>
          Or go back to the{" "}
          <Link href="/" className="font-medium text-[#222] underline underline-offset-2">homepage</Link>.
        </p>
      </div>
    </div>
  );
}
