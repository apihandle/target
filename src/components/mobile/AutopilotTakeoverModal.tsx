"use client";

import React, { useState } from "react";
import { X, KeyRound, ShieldCheck, CheckCircle2, FileDown, ArrowRight, Smartphone, Lock, AlertCircle } from "lucide-react";

interface AutopilotTakeoverModalProps {
  onClose: () => void;
  onFinishSuccess: () => void;
}

export default function AutopilotTakeoverModal({ onClose, onFinishSuccess }: AutopilotTakeoverModalProps) {
  const [step, setStep] = useState<"otp" | "receipt">("otp");
  const [otpVal, setOtpVal] = useState("");

  const handleKeyClick = (val: string) => {
    if (otpVal.length < 6) setOtpVal((prev) => prev + val);
  };

  const handleBackspace = () => {
    setOtpVal((prev) => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl flex flex-col justify-between p-5 select-none animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-status-warning animate-ping" />
            <span className="font-editorial text-sm font-semibold text-champagne-gold">
              {step === "otp" ? "MANUAL BROWSER INTERVENTION" : "TRANSACTION RECEIPT & ENCLAVE"}
            </span>
          </div>
          <p className="text-[10px] text-white/50 font-mono">
            {step === "otp"
              ? "Target agent paused. Keystrokes & taps execute in cloud viewport"
              : "HSM Nonce #419 • Zero-Knowledge Proof (ZKP) Verified"}
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-obsidian-container border border-white/15 flex items-center justify-center text-white/60 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {step === "otp" ? (
        /* Screen 5: Bank OTP Challenge & Vault Copilot */
        <div className="my-auto flex flex-col items-center w-full max-w-sm mx-auto">
          {/* Simulated Bank Challenge Viewport */}
          <div className="w-full p-4 rounded-2xl bg-obsidian-lowest border border-white/15 shadow-xl text-center">
            <div className="flex items-center justify-center space-x-1.5 text-white/60 text-xs font-mono mb-1">
              <Lock className="w-3.5 h-3.5 text-champagne-accent" />
              <span>HDFC Bank 3D Secure 2.0</span>
            </div>
            <p className="text-xs text-white/70">Enter 6-digit OTP sent to mobile registered with Visa Infinite</p>

            <div className="my-4 flex items-center justify-center space-x-2">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div
                  key={idx}
                  className={`w-9 h-11 rounded-lg border flex items-center justify-center text-base font-mono font-bold ${
                    otpVal[idx]
                      ? "border-champagne-accent bg-champagne-soft text-champagne-gold shadow-goldGlow"
                      : "border-white/15 bg-obsidian-container text-white/30"
                  }`}
                >
                  {otpVal[idx] || "•"}
                </div>
              ))}
            </div>

            <p className="text-[10px] text-white/40 font-mono">Amount: ₹8,940 • Merchant: Acko Insurance Ltd.</p>
          </div>

          {/* Target Vault Copilot Dock */}
          <div className="w-full mt-3 p-3 rounded-2xl bg-obsidian-low border border-champagne-accent/30 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-champagne-accent" />
              <div>
                <span className="text-[11px] font-semibold text-champagne-gold block">Vault Copilot</span>
                <span className="text-[9px] text-white/40 font-mono">OTP Detected in SMS</span>
              </div>
            </div>
            <button
              onClick={() => setOtpVal("492014")}
              className="px-2.5 py-1 rounded-full bg-champagne-accent hover:bg-champagne-gold text-obsidian-lowest text-[11px] font-bold transition-all shadow-sm"
            >
              Paste OTP: 492014
            </button>
          </div>

          {/* Keypad */}
          <div className="w-full grid grid-cols-3 gap-2 mt-4 max-w-xs">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
              <button
                key={k}
                onClick={() => handleKeyClick(k)}
                className="py-3 rounded-xl bg-obsidian-container border border-white/10 text-champagne-gold font-mono text-base font-semibold hover:bg-obsidian-bright active:scale-95 transition-all"
              >
                {k}
              </button>
            ))}
            <div />
            <button
              onClick={() => handleKeyClick("0")}
              className="py-3 rounded-xl bg-obsidian-container border border-white/10 text-champagne-gold font-mono text-base font-semibold hover:bg-obsidian-bright active:scale-95 transition-all"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="py-3 rounded-xl bg-obsidian-container border border-white/10 text-white/60 font-mono text-sm hover:bg-obsidian-bright active:scale-95 transition-all"
            >
              ⌫
            </button>
          </div>

          {/* Hand back to Target */}
          <button
            onClick={() => setStep("receipt")}
            className="w-full mt-4 py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow flex items-center justify-center space-x-2"
          >
            <span>Done, Hand back to TARGET</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Screen 6: Success & Vault Receipt */
        <div className="my-auto flex flex-col items-center w-full max-w-sm mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-status-success/20 border border-status-success/40 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(52,211,153,0.3)]">
            <CheckCircle2 className="w-8 h-8 text-status-success" />
          </div>

          <h3 className="font-editorial text-xl font-bold text-champagne-gold tracking-wide">
            Transaction Confirmed
          </h3>
          <p className="text-xs text-white/60 font-mono mt-1">Policy Activated & Synced into Enclave</p>

          <div className="w-full mt-5 p-4 rounded-2xl bg-obsidian-lowest border border-champagne-accent/30 text-left space-y-2.5 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-white/40">Amount Paid</span>
              <span className="text-champagne-accent font-semibold">₹8,940</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-white/40">Vehicle Covered</span>
              <span className="text-white/80">DL-01-AB-1234 (Honda City)</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-white/40">HSM Nonce #</span>
              <span className="text-champagne-gold">#419 (Hardware Proof)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40">ZKP Hash</span>
              <span className="text-[10px] text-champagne-accent truncate max-w-[160px]">
                0x8a92e41c...99a2
              </span>
            </div>
          </div>

          <div className="w-full mt-3 p-3 rounded-xl bg-obsidian-low border border-white/10 flex items-center justify-between text-xs text-white/70">
            <div className="flex items-center space-x-2">
              <FileDown className="w-4 h-4 text-champagne-accent" />
              <span className="text-[11px]">Acko-Policy-2026.pdf</span>
            </div>
            <span className="text-[10px] font-mono text-status-success">Stored in Enclave</span>
          </div>

          <p className="text-[11px] text-white/40 font-mono mt-3">
            CalSync Automation: Next renewal reminder set for 10 Nov 2027.
          </p>

          <button
            onClick={() => {
              onFinishSuccess();
              onClose();
            }}
            className="w-full mt-5 py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow"
          >
            Return to Command Hub
          </button>
        </div>
      )}
    </div>
  );
}