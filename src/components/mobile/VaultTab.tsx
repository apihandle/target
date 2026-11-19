"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Copy,
  Check,
  Plus,
  RotateCcw,
} from "lucide-react";

interface VirtualCard {
  id: string;
  name: string;
  type: string;
  number: string;
  exp: string;
  cvv: string;
  limit: string;
  isBurner?: boolean;
}

export default function VaultTab() {
  const [showSensitive, setShowSensitive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokedTokens, setRevokedTokens] = useState<string[]>([]);
  const [cards, setCards] = useState<VirtualCard[]>([
    {
      id: "primary",
      name: "TARGET Obsidian Enclave",
      type: "VISA INFINITE",
      number: "4111 8920 4819 8921",
      exp: "08/29",
      cvv: "742",
      limit: "₹10,00,000",
    },
  ]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  const handleCopyCard = (e: React.MouseEvent, num: string) => {
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(num.replace(/\s+/g, "")).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateBurnerCard = () => {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const newCard: VirtualCard = {
      id: `burner-${Date.now()}`,
      name: "Disposable Autopilot Burner",
      type: "VISA DEBIT VIRTUAL",
      number: `4532 9182 7261 ${randomSuffix}`,
      exp: "12/26",
      cvv: String(Math.floor(100 + Math.random() * 900)),
      limit: "₹5,000 (Single Merchant)",
      isBurner: true,
    };
    setCards((prev) => [newCard, ...prev]);
    setActiveCardIndex(0);
    setShowSensitive(true);
  };

  const handleToggleRevoke = (id: string) => {
    setRevokedTokens((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const currentCard = cards[activeCardIndex] || cards[0];

  return (
    <div className="flex flex-col min-h-screen bg-obsidian-surface text-champagne-gold pb-28 pt-4 px-4 font-sans select-none">
      {/* Header */}
      <header className="pb-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-champagne-accent" />
            <span className="font-editorial text-sm font-semibold tracking-wider text-champagne-gold">
              ENCRYPTED HARDWARE VAULT
            </span>
          </div>
          <p className="text-[10px] text-white/50 font-mono tracking-wider">
            ZERO-KNOWLEDGE ENCLAVE • HARDWARE ISOLATED • HSM ON-CHIP
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-status-success/20 text-status-success text-[9px] font-mono font-semibold border border-status-success/30">
          PROTECTED
        </span>
      </header>

      {/* Target Obsidian Virtual Card */}
      <section className="mt-4">
        <div
          onClick={() => setShowSensitive(!showSensitive)}
          className="w-full aspect-[1.586] rounded-2xl bg-gradient-to-tr from-obsidian-lowest via-obsidian-container to-[#1a272e] border border-champagne-accent/50 p-5 shadow-2xl relative overflow-hidden cursor-pointer group transition-all"
        >
          {/* Gold Shimmer Embellishment */}
          <div className="absolute top-0 right-0 w-36 h-36 bg-champagne-accent/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-champagne-accent/10 via-transparent to-transparent opacity-50 pointer-events-none" />

          <div className="relative z-10 flex flex-col justify-between h-full">
            {/* Card Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="font-editorial text-base font-bold tracking-widest text-champagne-gold">TARGET</span>
                <span className="text-[10px] font-mono tracking-wider text-champagne-accent/80 uppercase">
                  {currentCard.name}
                </span>
              </div>
              <span className="font-mono text-xs text-white/50">{currentCard.type}</span>
            </div>

            {/* Chip & Tap Icon */}
            <div className="flex items-center space-x-3 my-auto">
              <div className="w-9 h-7 rounded-md bg-gradient-to-tr from-[#99793d] to-[#e6c487] border border-white/30 shadow-inner flex items-center justify-center">
                <div className="w-5 h-4 border border-black/30 rounded-sm grid grid-cols-2 gap-0.5 p-0.5">
                  <div className="bg-black/20 rounded-none" />
                  <div className="bg-black/20 rounded-none" />
                </div>
              </div>
              <span className="text-[10px] text-white/40 font-mono tracking-widest">NFC / CONTACTLESS</span>
              {currentCard.isBurner && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-warning/20 text-status-warning font-mono">
                  ONE-TIME BURNER
                </span>
              )}
            </div>

            {/* Card Number & Sensitive Info */}
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-base font-semibold tracking-widest text-champagne-gold">
                  {showSensitive
                    ? currentCard.number
                    : `${currentCard.number.slice(0, 4)} •••• •••• ${currentCard.number.slice(-4)}`}
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    aria-label="Copy card number"
                    onClick={(e) => handleCopyCard(e, currentCard.number)}
                    className="text-white/40 hover:text-champagne-accent transition-colors p-1"
                  >
                    {copied ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    aria-label={showSensitive ? "Hide sensitive details" : "Reveal sensitive details"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSensitive(!showSensitive);
                    }}
                    className="text-white/40 group-hover:text-champagne-accent transition-colors p-1"
                  >
                    {showSensitive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-white/60">
                <span>EXP: {currentCard.exp}</span>
                <span>CVV: {showSensitive ? currentCard.cvv : "•••"}</span>
                <span className="text-champagne-accent font-semibold">
                  {showSensitive ? `LIMIT: ${currentCard.limit}` : "TAP TO REVEAL"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Controls & Burner Generator */}
        <div className="flex items-center justify-between mt-2.5 px-1">
          <div className="flex items-center space-x-1.5">
            {cards.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCardIndex(i)}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  activeCardIndex === i ? "bg-champagne-gold w-6" : "bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleGenerateBurnerCard}
            className="text-[11px] font-mono text-champagne-accent hover:text-white flex items-center space-x-1 py-1 px-2.5 rounded-lg bg-obsidian-container border border-champagne-accent/30 hover:border-champagne-accent transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate Burner Card (₹5k)</span>
          </button>
        </div>
      </section>

      {/* Active Permission Scopes */}
      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
          Active Autopilot Scopes & Tokens
        </h3>

        <div className="space-y-2">
          <div className="p-3 rounded-xl bg-obsidian-low border border-white/10 flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-champagne-gold">Acko Insurance Checkout</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-success/20 text-status-success font-mono">
                  ONE-TIME EXPIRING
                </span>
              </div>
              <p className="text-[10px] text-white/50 mt-0.5">Autofill single card transaction up to ₹9,000</p>
            </div>
            {revokedTokens.includes("acko") ? (
              <button
                type="button"
                onClick={() => handleToggleRevoke("acko")}
                className="px-2.5 py-1 rounded-lg bg-obsidian-container border border-champagne-accent/30 text-champagne-accent text-[10px] hover:bg-champagne-accent/10 transition-colors flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Re-enable</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleToggleRevoke("acko")}
                className="px-2.5 py-1 rounded-lg bg-obsidian-container border border-status-danger/30 text-status-danger text-[10px] hover:bg-status-danger/10 transition-colors"
              >
                Revoke Token
              </button>
            )}
          </div>

          <div className="p-3 rounded-xl bg-obsidian-low border border-white/10 flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold text-champagne-gold">Google Calendar Sync</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-champagne-soft text-champagne-accent font-mono">
                  READ/WRITE
                </span>
              </div>
              <p className="text-[10px] text-white/50 mt-0.5">Schedule flights and priority meetings</p>
            </div>
            {revokedTokens.includes("gcal") ? (
              <button
                type="button"
                onClick={() => handleToggleRevoke("gcal")}
                className="px-2.5 py-1 rounded-lg bg-obsidian-container border border-champagne-accent/30 text-champagne-accent text-[10px] hover:bg-champagne-accent/10 transition-colors flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Re-enable</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleToggleRevoke("gcal")}
                className="px-2.5 py-1 rounded-lg bg-obsidian-container border border-status-danger/30 text-status-danger text-[10px] hover:bg-status-danger/10 transition-colors"
              >
                Revoke Token
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Cryptographic Access Audit Log */}
      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">
          Cryptographic Access Audit Trail
        </h3>
        <div className="space-y-1.5 font-mono text-[10px]">
          <div className="p-2 rounded-xl bg-obsidian-lowest border border-white/5 flex items-center justify-between text-white/50">
            <span>22:15:02 • HSM Nonce #419 verified</span>
            <span className="text-champagne-accent">AES-256-GCM</span>
          </div>
          <div className="p-2 rounded-xl bg-obsidian-lowest border border-white/5 flex items-center justify-between text-white/50">
            <span>21:40:19 • Zero-Knowledge Proof (ZKP) generated</span>
            <span className="text-status-success">VALID</span>
          </div>
          <div className="p-2 rounded-xl bg-obsidian-lowest border border-white/5 flex items-center justify-between text-white/50">
            <span>19:30:10 • Vault PIN re-authenticated on hardware</span>
            <span className="text-white/60">Biometric Ok</span>
          </div>
        </div>
      </section>
    </div>
  );
}
