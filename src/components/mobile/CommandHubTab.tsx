"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  Camera,
  ArrowUp,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Zap,
  Loader2,
  Volume2,
  RotateCcw,
} from "lucide-react";
import { BriefingItem, ChatMessage } from "./types";

interface CommandHubTabProps {
  onOpenVoice: () => void;
  onOpenVision: () => void;
  onOpenAutopilot: () => void;
  queuedPrompt?: string | null;
  onClearQueuedPrompt?: () => void;
}

const INITIAL_MESSAGES: ChatMessage[] = [
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
];

export default function CommandHubTab({
  onOpenVoice,
  onOpenVision,
  onOpenAutopilot,
  queuedPrompt,
  onClearQueuedPrompt,
}: CommandHubTabProps) {
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);

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

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleSend = async (customText?: string) => {
    const text = (customText ?? inputText).trim();
    if (!text || isStreaming) return;

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text,
      timestamp: time,
    };
    const assistantId = `a-${Date.now()}`;
    const initialAssistantMsg: ChatMessage = {
      id: assistantId,
      sender: "target",
      text: "",
      timestamp: time,
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    if (!customText) setInputText("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Chat API responded with ${res.status}`);
      }

      if (!res.body) {
        const fullText = await res.text();
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: fullText || "Understood." } : m))
        );
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        streamed += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: streamed } : m))
        );
      }
      if (!streamed.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: "All parameters analyzed and aligned with your Vault Enclave." }
              : m
          )
        );
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "Request failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: `Maaf kijiye, TARGET reply nahi kar paya: ${msg}` }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    if (queuedPrompt && queuedPrompt.trim()) {
      const prompt = queuedPrompt.trim();
      onClearQueuedPrompt?.();
      const timer = setTimeout(() => {
        handleSend(prompt);
      }, 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt]);

  const handleBriefingAction = (item: BriefingItem) => {
    if (item.actionText === "Open Autopilot") {
      onOpenAutopilot();
    } else {
      handleSend(`${item.actionText}: ${item.title} (${item.subtitle})`);
    }
  };

  const handleSpeakMessage = (msgId: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => setSpeakingMsgId(null);
    utter.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utter);
  };

  const handleClearChat = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMsgId(null);
    setMessages(INITIAL_MESSAGES);
  };

  return (
    <div className="flex flex-col min-h-screen bg-obsidian-surface text-champagne-gold pb-36 pt-4 px-4 font-sans select-none">
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
            <p className="text-[10px] text-white/50 font-mono tracking-wider">
              OBSIDIAN ENCLAVE • ONLINE
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            aria-label="Clear chat"
            onClick={handleClearChat}
            className="p-1.5 rounded-lg bg-obsidian-container border border-white/10 text-white/50 hover:text-white transition-colors"
            title="Reset Conversation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-champagne-soft border border-champagne-accent/30">
            <Sparkles className="w-3 h-3 text-champagne-accent" />
            <span className="text-[10px] font-mono text-champagne-accent font-semibold tracking-wide">
              INTELLIGENCE ACTIVE
            </span>
          </div>
        </div>
      </header>

      {/* Proactive Intelligence Banner */}
      <section className="mt-3 p-3 rounded-2xl bg-gradient-to-r from-obsidian-container via-obsidian-low to-obsidian-container border border-white/10 relative overflow-hidden">
        <div className="flex items-start space-x-2.5">
          <div className="w-7 h-7 rounded-full bg-champagne-gold/10 border border-champagne-accent/40 flex items-center justify-center shrink-0 mt-0.5">
            <Zap className="w-3.5 h-3.5 text-champagne-accent" />
          </div>
          <div className="flex-1">
            <h4 className="text-xs font-semibold text-champagne-gold tracking-wide">
              Autopilot Autonomous Pre-Checkout Ready
            </h4>
            <p className="text-[11px] text-white/70 mt-0.5 leading-snug">
              Acko policy checkout prepared in virtual browser. Coupon code TGT_EXCLUSIVE saved ₹1,200.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAutopilot}
            className="px-2.5 py-1 rounded-lg bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-[10px] tracking-wide transition-all shrink-0 self-center shadow-goldGlow"
          >
            Inspect
          </button>
        </div>
      </section>

      {/* Daily Briefings Section */}
      <section className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
            Priority Briefings ({briefings.length})
          </span>
          <span className="text-[10px] font-mono text-champagne-accent">Zero Friction</span>
        </div>

        <div className="space-y-2">
          {briefings.map((b) => (
            <div
              key={b.id}
              className="p-3 rounded-xl bg-obsidian-low border border-white/10 hover:border-champagne-accent/40 transition-all flex items-center justify-between group"
            >
              <div className="flex items-start space-x-2.5">
                {b.category === "urgent" ? (
                  <AlertCircle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="flex items-center space-x-2">
                    <h5 className="text-xs font-semibold text-champagne-gold">{b.title}</h5>
                    {b.amount && (
                      <span className="text-[10px] font-mono text-champagne-accent font-semibold bg-champagne-soft px-1.5 py-0.2 rounded border border-champagne-accent/30">
                        {b.amount}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/60 mt-0.5">{b.subtitle}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleBriefingAction(b)}
                className="flex items-center space-x-1 text-xs font-medium text-champagne-accent hover:text-white transition-colors ml-2 shrink-0 group-hover:translate-x-0.5 transition-transform"
              >
                <span>{b.actionText}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* One-Thread Context Stream */}
      <section className="mt-5 flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
            Autonomous One-Thread Stream
          </span>
          <span className="text-[10px] font-mono text-white/40">Continuous Memory</span>
        </div>

        <div className="flex-1 space-y-3 pb-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                  m.sender === "user"
                    ? "bg-champagne-gold text-obsidian-lowest font-medium rounded-br-xs shadow-md"
                    : "bg-obsidian-container border border-white/10 text-champagne-gold rounded-bl-xs shadow-lg"
                }`}
              >
                {m.sender === "target" && (
                  <div className="flex items-center justify-between mb-1 text-[10px] font-mono text-champagne-accent/80 border-b border-white/5 pb-1">
                    <span className="font-semibold tracking-wider">TARGET ENCLAVE</span>
                    <button
                      type="button"
                      aria-label="Read response aloud"
                      onClick={() => handleSpeakMessage(m.id, m.text)}
                      className={`p-0.5 hover:text-champagne-gold transition-colors ${
                        speakingMsgId === m.id ? "text-champagne-gold animate-pulse" : "text-white/40"
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="whitespace-pre-wrap">{m.text}</div>

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
                        type="button"
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
          <div ref={messagesEndRef} />
        </div>
      </section>

      {/* Floating Input Dock & Quick Actions */}
      <div className="fixed bottom-16 left-4 right-4 max-w-md mx-auto z-30">
        {/* Quick Action Chips */}
        <div className="flex items-center space-x-1.5 mb-2 overflow-x-auto px-1 py-0.5">
          {[
            "Renew Acko Insurance",
            "IndiGo flight 6E-204 status",
            "Vault Enclave card balance",
            "Synthesize courier panel",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSend(chip)}
              className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-obsidian-lowest/90 backdrop-blur-md border border-white/10 text-white/70 hover:text-champagne-gold hover:border-champagne-accent/40 whitespace-nowrap transition-all shadow-md disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="bg-obsidian-lowest/90 backdrop-blur-2xl border border-white/15 rounded-full p-1.5 flex items-center shadow-2xl shadow-black/80">
          <button
            type="button"
            onClick={onOpenVision}
            title="Vision Mode"
            className="w-10 h-10 rounded-full bg-obsidian-container border border-white/10 flex items-center justify-center text-white/70 hover:text-champagne-gold hover:border-champagne-accent/40 transition-all mr-1.5 shrink-0"
          >
            <Camera className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            disabled={isStreaming}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={isStreaming ? "TARGET is thinking..." : "Ask TARGET, schedule actions, or build panel..."}
            className="flex-1 bg-transparent border-none text-xs text-champagne-gold placeholder-white/30 focus:outline-none px-2 disabled:opacity-50"
          />

          <button
            type="button"
            onClick={onOpenVoice}
            title="Acoustic Voice Mode"
            className="w-10 h-10 rounded-full bg-champagne-soft border border-champagne-accent/40 flex items-center justify-center text-champagne-accent hover:bg-champagne-accent hover:text-obsidian-lowest transition-all ml-1 shrink-0"
          >
            <Mic className="w-4 h-4" />
          </button>

          {isStreaming ? (
            <div className="w-10 h-10 rounded-full bg-champagne-soft border border-champagne-accent/40 flex items-center justify-center text-champagne-accent ml-1 shrink-0">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            inputText.trim() && (
              <button
                type="button"
                onClick={() => handleSend()}
                className="w-10 h-10 rounded-full bg-champagne-gold text-obsidian-lowest flex items-center justify-center hover:bg-white transition-all ml-1 shrink-0 shadow-sm"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
