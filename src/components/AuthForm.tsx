"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateCredentials } from "@/lib/validate";
import GoogleButton from "./GoogleButton";
import Turnstile, { type TurnstileHandle } from "./Turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Mode = "signin" | "signup";

/**
 * Dark glass auth card (matches the water hero), centered heading, social button, "or" divider,
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
  const [captcha, setCaptcha] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);

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
    if (SITE_KEY && !captcha) return setError("Please wait a moment while we check you're not a bot, then try again.");
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, ...(captcha ? { captchaToken: captcha } : {}) },
        });
        if (error) return setError(error.message);
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setInfo("Check your inbox to confirm your email, then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, ...(captcha ? { options: { captchaToken: captcha } } : {}) });
        if (error) return setError(error.message);
        router.push(next);
        router.refresh();
      }
    } finally {
      setLoading(false);
      // A captcha token works once; get a fresh one for the next try.
      captchaRef.current?.reset();
    }
  }

  const input =
    "h-10 w-full rounded-[10px] border border-white/10 bg-white/[0.06] px-3.5 text-[14px] text-stucco outline-none transition placeholder:text-stucco/40 focus:border-sun-glint/60 focus:ring-2 focus:ring-sun-glint/20";

  return (
    <div className="w-full max-w-[448px] overflow-hidden rounded-[18px] border border-white/10 bg-black/40 text-stucco shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className="px-6 pb-8 pt-8 sm:px-10">
        <div className="text-center">
          <Link href="/" aria-label="TARGET home" className="font-script text-[44px] leading-none text-stucco">Target</Link>
          <h1 className="mt-3 font-display text-[24px] font-normal leading-tight">
            {mode === "signin" ? "Sign in to your Target account" : "Create your Target account"}
          </h1>
        </div>

        <div className="mt-6">
          <GoogleButton next={next} variant="glass" />
        </div>

        <div className="my-5 flex items-center gap-4 text-[13px] text-stucco/40">
          <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
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
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-stucco/40 hover:text-stucco"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPw && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </span>
          </label>
          <Turnstile ref={captchaRef} siteKey={SITE_KEY} onToken={setCaptcha} />
          <button
            data-testid="auth-submit"
            type="submit"
            disabled={loading}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-sun-glint text-[14px] font-medium text-deep-sea transition hover:bg-[#f0d6a4] disabled:opacity-60"
          >
            {loading ? "Please wait…" : "Continue"}
            {!loading && <span aria-hidden="true" className="text-[10px]">▶</span>}
          </button>
        </form>
        {error && <p data-testid="auth-error" className="mt-3 text-center text-[13px] text-rose-400">{error}</p>}
        {info && <p data-testid="auth-info" className="mt-3 text-center text-[13px] text-emerald-400">{info}</p>}
      </div>

      <div className="space-y-1 border-t border-white/10 bg-white/[0.03] px-6 py-5 text-center text-[14px] text-stucco/60">
        {mode === "signin" ? (
          <p>
            Don&apos;t have an account?{" "}
            <button type="button" data-testid="tab-signup" onClick={() => switchTo("signup")} className="font-medium text-sun-glint hover:text-stucco">
              Create one here
            </button>
            .
          </p>
        ) : (
          <p>
            Already have an account?{" "}
            <button type="button" data-testid="tab-signin" onClick={() => switchTo("signin")} className="font-medium text-sun-glint hover:text-stucco">
              Sign in here
            </button>
            .
          </p>
        )}
        <p>
          Or go back to the{" "}
          <Link href="/" className="font-medium text-sun-glint hover:text-stucco">homepage</Link>.
        </p>
      </div>
    </div>
  );
}
