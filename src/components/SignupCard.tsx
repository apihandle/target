"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import GoogleButton from "./GoogleButton";

export default function SignupCard() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "error" | "ok">("idle");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    setStatus(valid ? "ok" : "error");
    if (valid) router.push(`/login?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <div id="signup" className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl">
      <GoogleButton />
      <div className="my-4 flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={submit} noValidate>
        <input
          data-testid="email-input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
          className="w-full rounded-full border border-white/15 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-sun-glint"
        />
        <button data-testid="email-submit" type="submit" className="mt-3 w-full rounded-full bg-sun-glint py-3 text-sm font-semibold text-deep-sea transition hover:bg-[#f0d6a4]">
          Continue
        </button>
      </form>
      {status === "error" && <p data-testid="email-error" className="mt-3 text-center text-xs text-rose-400">Please enter a valid email.</p>}
      {status === "ok" && <p data-testid="email-ok" className="mt-3 text-center text-xs text-emerald-400">Taking you to sign up…</p>}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-white/40">
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
