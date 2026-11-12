"use client";

import React, { useState } from "react";
import { Mic, Camera, ArrowUp, Sparkles, AlertCircle, CheckCircle2, ChevronRight, Zap } from "lucide-react";
import { BriefingItem, ChatMessage } from "./types";

interface CommandHubTabProps {
  onOpenVoice: () => void;
  onOpenVision: () => void;
  onOpenAutopilot: () => void;
}

export default function CommandHubTab({ onOpenVoice, onOpenVision, onOpenAutopilot }: CommandHubTabProps) {
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "target",
      text: "Good evening. All scheduled tasks are aligned. I have prepared your daily briefing card and queued the Acko vehicle insurance renewal in Autopilot.",
      timestamp: "10:14 PM",
    },
    {
      id: "2",
      sender: "target",
      text: "Detected electricity bill due tomorrow (₹3,410). Would you like me to process payment via Vault Enclave?",
      timestamp: "10:15 PM",
      card: {
        title: "Tata Power Delhi — Consumer #904128",
        description: "Due: Nov 14 • Amount: ₹3,410 • Auto-debit available",
        status: "Pending Approval",
        actionLabel: "Authorize Payment via Vault",
      },
    },
  ]);

  const briefings: BriefingItem[] = [
    {
      id: "b1",
      title: "Vehicle Insurance Renewal",
      subtitle: "Acko policy expires in 4 days • Saved ₹1,200 via coupon",
      category: "urgent",
      amount: "₹8,940",
      actionText: "Open Autopilot",
    },
    {
      id: "b2",
      title: "Passport Renewal Slot",
      subtitle: "Found opening at RPO Delhi for Nov 18, 10:30 AM",
      category: "action",
      actionText: "Hold Slot",
    },
  ];

  const handleSend = () => {
    if (!inputText.trim()) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      text: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    // Simulated assistant response
    setTimeout(() => {
      const reply: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: "target",
        text: `Understood. Analyzing "${userMsg.text}". All secure parameters checked against your Vault Enclave.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, reply]);
    }, 800);
  };

  return (
    <div className="flex flex-col min-h-screen bg-obsidian-surface text-champagne-gold pb-28 pt-4 px-4 font-sans select-none">
      {/* Top Bar */}
      <header className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-obsidian-container border border-champagne-accent/30 flex items-center justify-center shadow-goldGlow">
            <span className="font-editorial text-lg font-bold text-champagne-gold tracking-widest">T</span>
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-editorial text-sm font-semibold tracking-wider text-champagne-gold">TARGET</span>
              <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
            </div>
            <p className="text-[10px] text-white/50 tracking-wider font-mono">OBSIDIAN ENCLAVE • ONLINE</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenAutopilot}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-champagne-soft border border-champagne-accent/40 text-[11px] text-champagne-accent font-medium hover:bg-champagne-accent/25 transition-all"
          >
            <Zap className="w-3 h-3" />
            <span>Autopilot #9021</span>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-champagne-accent/40 to-white/10 border border-white/20 flex items-center justify-center text-xs font-semibold text-champagne-gold">
            V
          </div>
        </div>
      </header>

      {/* Daily Briefing Hero */}
      <section className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-champagne-accent" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">Daily Briefing & Priorities</h2>
          </div>
          <span className="text-[10px] font-mono text-champagne-accent/80">3 ACTIONS READY</span>
        </div>

        <div className="space-y-2.5">
          {briefings.map((item) => (
            <div
              key={item.id}
              className="bg-obsidian-low border border-white/10 hover:border-champagne-accent/40 rounded-2xl p-3.5 transition-all duration-200 shadow-card relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-champagne-accent/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded-full bg-champagne-soft text-champagne-accent text-[9px] font-mono font-medium border border-champagne-accent/20">
                      PRIORITY
                    </span>
                    <h3 className="text-sm font-semibold text-champagne-gold">{item.title}</h3>
                  </div>
                  <p className="text-xs text-white/60 mt-1">{item.subtitle}</p>
                </div>
                {item.amount && (
                  <div className="text-right">
                    <span className="text-xs font-mono font-semibold text-champagne-accent">{item.amount}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/40 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1 text-status-warning" />
                  Requires Biometric Authorization
                </span>
                <button
                  onClick={item.actionText === "Open Autopilot" ? onOpenAutopilot : undefined}
                  className="px-3 py-1 rounded-full bg-champagne-gold text-obsidian-lowest text-xs font-semibold hover:bg-white flex items-center space-x-1 transition-all shadow-sm"
                >
                  <span>{item.actionText}</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Proactive Dialogue Stream (One Thread) */}
      <section className="mt-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">One Thread Dialogue</h2>
          <span className="text-[10px] font-mono text-white/40">TLS 1.3 SYNCED</span>
        </div>

        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                  m.sender === "user"
                    ? "bg-champagne-gold text-obsidian-lowest font-medium rounded-br-none"
                    : "bg-obsidian-container border border-white/10 text-champagne-gold rounded-bl-none shadow-sm"
                }`}
              >
                <p>{m.text}</p>

                {m.card && (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-obsidian-lowest border border-champagne-accent/30 text-white">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-champagne-accent">
                      <span>{m.card.title}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-warning/20 text-status-warning border border-status-warning/30">
                        {m.card.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/60 mt-1">{m.card.description}</p>
                    {m.card.actionLabel && (
                      <button
                        onClick={onOpenAutopilot}
                        className="mt-2 w-full py-1.5 rounded-lg bg-champagne-accent text-obsidian-lowest font-semibold text-[11px] hover:bg-champagne-gold transition-colors flex items-center justify-center space-x-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{m.card.actionLabel}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[9px] text-white/30 font-mono mt-1 px-1">{m.timestamp}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Floating Input Dock */}
      <div className="fixed bottom-16 left-4 right-4 max-w-md mx-auto z-30">
        <div className="bg-obsidian-lowest/90 backdrop-blur-2xl border border-white/15 rounded-full p-1.5 flex items-center shadow-2xl shadow-black/80">
          <button
            onClick={onOpenVision}
            title="Vision Mode"
            className="w-10 h-10 rounded-full bg-obsidian-container border border-white/10 flex items-center justify-center text-white/70 hover:text-champagne-gold hover:border-champagne-accent/40 transition-all mr-1.5 shrink-0"
          >
            <Camera className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask TARGET, schedule actions, or build panel..."
            className="flex-1 bg-transparent border-none text-xs text-champagne-gold placeholder-white/30 focus:outline-none px-2"
          />

          <button
            onClick={onOpenVoice}
            title="Acoustic Voice Mode"
            className="w-10 h-10 rounded-full bg-champagne-soft border border-champagne-accent/40 flex items-center justify-center text-champagne-accent hover:bg-champagne-accent hover:text-obsidian-lowest transition-all ml-1 shrink-0"
          >
            <Mic className="w-4 h-4" />
          </button>

          {inputText.trim() && (
            <button
              onClick={handleSend}
              className="w-10 h-10 rounded-full bg-champagne-gold text-obsidian-lowest flex items-center justify-center hover:bg-white transition-all ml-1 shrink-0 shadow-sm"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}