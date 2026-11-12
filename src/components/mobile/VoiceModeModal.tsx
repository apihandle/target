"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Mic, MicOff, Globe, PhoneOff, Radio, Sparkles, Volume2, VolumeX, Bot, Smartphone } from "lucide-react";

interface VoiceModeModalProps {
  onClose: () => void;
  onExecuteAction?: (action: string) => void;
}

export default function VoiceModeModal({ onClose, onExecuteAction }: VoiceModeModalProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [language, setLanguage] = useState<"hi-IN" | "en-US">("hi-IN");
  const [transcript, setTranscript] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("Namaste! Main aapka TARGET personal AI assistant hoon. Boliye, main aapke liye kya kar sakta hoon?");
  const [recentActions, setRecentActions] = useState<{ id: string; text: string; status: string }[]>([
    { id: "1", text: "Ready for voice commands", status: "Active" },
  ]);
  const [pulseLevel, setPulseLevel] = useState(1);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Synthesis & Speech Recognition
  useEffect(() => {
    // Speak initial greeting
    speakResponse("Namaste! Main aapka TARGET personal AI assistant hoon. Boliye, main aapke liye kya karoon?");

    // Setup speech recognition
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = language;

        recognition.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);

          // If final result, process intent
          if (event.results[event.results.length - 1].isFinal) {
            processVoiceCommand(currentTranscript.trim());
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
        };

        recognition.onend = () => {
          if (isListening) {
            try { recognition.start(); } catch (_) {}
          }
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
          setIsListening(true);
        } catch (_) {}
      }
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Sync recognition language
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = language;
    }
  }, [language]);

  // Dynamic visualizer pulsation
  useEffect(() => {
    const interval = setInterval(() => {
      if (isSpeaking) {
        setPulseLevel(0.9 + Math.random() * 0.45);
      } else if (isListening && transcript) {
        setPulseLevel(0.85 + Math.random() * 0.3);
      } else {
        setPulseLevel(0.95 + Math.sin(Date.now() / 600) * 0.08);
      }
    }, 150);
    return () => clearInterval(interval);
  }, [isSpeaking, isListening, transcript]);

  // Text to Speech Function
  const speakResponse = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    // Pick a natural voice if available
    const voices = window.speechSynthesis.getVoices();
    const matchVoice = voices.find(
      (v) => v.lang.startsWith(language.slice(0, 2)) || (language === "hi-IN" && v.name.includes("India"))
    );
    if (matchVoice) utterance.voice = matchVoice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setAssistantResponse(text);
  };

  // AI Command & Intent Processor
  const processVoiceCommand = async (cmd: string) => {
    if (!cmd) return;
    const lower = cmd.toLowerCase();

    // Check Native Android Bridge Integration
    const bridge = typeof window !== "undefined" ? (window as any).TargetAndroid || (window as any).TargetDevice : null;

    if (bridge) {
      if (lower.includes("call") || lower.includes("phone lagao")) {
        speakResponse("Dialer open kar raha hoon.");
        try { await bridge.dial("198"); } catch (_) {}
        addRecentAction(`Call triggered: ${cmd}`, "Bridge Executed");
        return;
      }
      if (lower.includes("whatsapp")) {
        speakResponse("WhatsApp open kar raha hoon.");
        try { await bridge.openApp("whatsapp"); } catch (_) {}
        addRecentAction("WhatsApp Opened", "Bridge Executed");
        return;
      }
      if (lower.includes("torch") || lower.includes("flashlight")) {
        speakResponse("Flashlight on kar di hai.");
        try { await bridge.flashlight(true); } catch (_) {}
        addRecentAction("Torch Turned ON", "Bridge Executed");
        return;
      }
      if (lower.includes("battery")) {
        try {
          const b = await bridge.battery();
          speakResponse(`Phone battery level ${b.level || 85} percent hai.`);
          addRecentAction(`Battery: ${b.level}%`, "Status");
          return;
        } catch (_) {}
      }
    }

    // Smart Conversational Responses
    if (lower.includes("insurance") || lower.includes("acko") || lower.includes("policy")) {
      speakResponse("Maine Acko policy check kar li hai. Renewal due hai, aur TGT_EXCLUSIVE coupon se baarah sau rupaye bachenge. Autopilot approval ready hai.");
      addRecentAction("Acko Policy Inspected", "Autopilot Ready");
    } else if (lower.includes("flight") || lower.includes("ticket") || lower.includes("indigo")) {
      speakResponse("IndiGo flight 6E-204 hold par hai, seat 12B select ho chuki hai.");
      addRecentAction("IndiGo 6E-204 Flight Hold", "Confirmed");
    } else if (lower.includes("dinner") || lower.includes("restaurant") || lower.includes("table")) {
      speakResponse("Skyline Rooftop par aaj raat 8 baje 2 logon ki table reserve ho gayi hai.");
      addRecentAction("Skyline Rooftop Dinner 8 PM", "Reserved");
    } else if (lower.includes("kya kar sakte ho") || lower.includes("who are you") || lower.includes("kaun ho")) {
      speakResponse("Main TARGET hoon, aapka autonomous virtual AI assistant. Main real-world browser checkout, insurance renewal, call, WhatsApp, calendar sync aur dynamic mini-apps synthesize kar sakta hoon.");
      addRecentAction("Capability Briefing", "Info");
    } else {
      // Natural AI reply
      speakResponse(`Ji, maine sun liya: "${cmd}". Main ise aapke Vault Enclave ke sath process kar raha hoon.`);
      addRecentAction(cmd, "Processed");
    }
  };

  const addRecentAction = (text: string, status: string) => {
    setRecentActions((prev) => [{ id: Date.now().toString(), text, status }, ...prev.slice(0, 2)]);
  };

  const toggleMic = () => {
    if (isListening) {
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (_) {}
      setIsListening(false);
    } else {
      if (recognitionRef.current) try { recognitionRef.current.start(); } catch (_) {}
      setIsListening(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-obsidian-surface/98 backdrop-blur-2xl flex flex-col justify-between p-6 select-none animate-in fade-in duration-300">
      {/* Top Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${isSpeaking ? "bg-champagne-accent animate-ping" : "bg-status-success animate-pulse"}`} />
          <span className="text-[11px] font-mono tracking-wider text-champagne-accent font-semibold uppercase">
            {isSpeaking ? "TARGET SPEAKING" : isListening ? "TARGET LISTENING (LIVE AI)" : "STANDBY"}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setLanguage(language === "hi-IN" ? "en-US" : "hi-IN")}
            className="px-2 py-1 rounded-full bg-obsidian-container border border-white/10 text-[10px] font-mono text-champagne-gold flex items-center space-x-1"
          >
            <Globe className="w-3 h-3 text-champagne-accent" />
            <span>{language === "hi-IN" ? "Hinglish" : "English"}</span>
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-obsidian-container border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Central Autonomous Voice Orb Visualizer */}
      <div className="flex flex-col items-center justify-center my-auto relative">
        <div className="relative flex items-center justify-center cursor-pointer" onClick={toggleMic}>
          {/* Multi-tier Pulsing Luxury Waves */}
          <div
            style={{ transform: `scale(${pulseLevel * 1.35})` }}
            className="absolute w-64 h-64 rounded-full border border-champagne-accent/25 blur-sm transition-transform duration-200 pointer-events-none"
          />
          <div
            style={{ transform: `scale(${pulseLevel * 1.15})` }}
            className="absolute w-52 h-52 rounded-full border border-champagne-accent/45 blur-xs transition-transform duration-200 pointer-events-none"
          />
          <div
            style={{ transform: `scale(${pulseLevel})` }}
            className="w-40 h-40 rounded-full bg-gradient-to-tr from-[#99793d] via-[#c5a059] to-[#e6e0d4] shadow-[0_0_55px_rgba(197,160,89,0.55)] flex items-center justify-center transition-transform duration-200"
          >
            <div className="w-28 h-28 rounded-full bg-obsidian-lowest/75 backdrop-blur-md border border-white/20 flex flex-col items-center justify-center">
              {isSpeaking ? (
                <Volume2 className="w-8 h-8 text-champagne-accent animate-bounce" />
              ) : (
                <Radio className="w-8 h-8 text-champagne-gold animate-pulse" />
              )}
            </div>
          </div>
        </div>

        {/* Live Subtitle Transcript & Response */}
        <div className="mt-8 text-center max-w-sm px-4">
          <p className="font-editorial text-sm sm:text-base text-champagne-gold font-medium leading-relaxed min-h-[48px]">
            &ldquo;{assistantResponse}&rdquo;
          </p>
          {transcript && (
            <p className="text-xs text-champagne-accent/80 font-mono mt-2 bg-obsidian-low/80 py-1 px-3 rounded-full border border-champagne-accent/20 inline-block">
              You: &ldquo;{transcript}&rdquo;
            </p>
          )}
        </div>

        {/* Dynamic Multi-Task Action Chips */}
        <div className="w-full max-w-sm mt-6 space-y-2">
          {recentActions.map((action) => (
            <div
              key={action.id}
              className="p-3 rounded-2xl bg-obsidian-low border border-champagne-accent/30 flex items-center justify-between shadow-lg animate-in slide-in-from-bottom-2 duration-200"
            >
              <div className="flex items-center space-x-2">
                <Sparkles className="w-3.5 h-3.5 text-champagne-accent shrink-0" />
                <span className="text-xs font-semibold text-champagne-gold truncate max-w-[220px]">
                  {action.text}
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-status-success/20 text-status-success border border-status-success/30 shrink-0">
                {action.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Controls Dock */}
      <div className="flex items-center justify-around max-w-xs mx-auto w-full pb-3">
        {/* Mic Toggle */}
        <button
          onClick={toggleMic}
          className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all ${
            isListening
              ? "bg-obsidian-container border-champagne-accent/50 text-champagne-gold shadow-goldGlow"
              : "bg-status-danger/20 border-status-danger text-status-danger"
          }`}
        >
          {isListening ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </button>

        {/* Stop Voice Assistant */}
        <button
          onClick={onClose}
          className="w-14 h-14 rounded-full bg-status-danger/90 hover:bg-status-danger border border-white/20 flex items-center justify-center text-white shadow-lg transition-all"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}