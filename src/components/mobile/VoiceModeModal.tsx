"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Mic, MicOff, Globe, PhoneOff, Radio, Sparkles, Volume2 } from "lucide-react";

interface VoiceModeModalProps {
  onClose: () => void;
  onExecuteAction?: (action: string) => void;
}

/* Web Speech API + Android bridge typings (not in the standard DOM lib) */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface TargetAndroidBridge {
  dial: (number: string) => Promise<{ ok?: boolean; error?: string } | void> | { ok?: boolean; error?: string } | void;
  openApp: (pkg: string) => Promise<{ ok?: boolean; error?: string } | void> | { ok?: boolean; error?: string } | void;
  flashlight: (on: boolean) => Promise<{ ok?: boolean; error?: string } | void> | { ok?: boolean; error?: string } | void;
  battery: () => Promise<{ ok?: boolean; level?: number; charging?: boolean; error?: string }>;
}
interface TargetWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  TargetAndroid?: TargetAndroidBridge;
  TargetDevice?: TargetAndroidBridge;
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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const languageRef = useRef(language);
  const speakRef = useRef<(text: string) => void>(() => undefined);
  const activeRequestRef = useRef<AbortController | null>(null);
  const commandHandlerRef = useRef<(command: string) => void>(() => undefined);
  languageRef.current = language;

  // Initialize speech once. Refs keep browser callbacks in sync without restarting recognition on every render.
  useEffect(() => {
    speakRef.current("Namaste! Main aapka TARGET personal AI assistant hoon. Boliye, main aapke liye kya karoon?");

    if (typeof window !== "undefined") {
      const tw = window as TargetWindow;
      const SpeechRecognition = tw.SpeechRecognition || tw.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = language;
        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
          if (event.results[event.results.length - 1]?.isFinal) {
            commandHandlerRef.current(currentTranscript.trim());
          }
        };
        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            listeningRef.current = false;
            setIsListening(false);
          }
          console.warn("Speech recognition error:", event.error);
        };
        recognition.onstart = () => {
          listeningRef.current = true;
          setIsListening(true);
        };
        recognition.onend = () => {
          if (listeningRef.current && recognitionRef.current === recognition) {
            try { recognition.start(); } catch { /* recognition may already be starting */ }
          } else {
            setIsListening(false);
          }
        };
        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          listeningRef.current = false;
        }
      }
    }

    return () => {
      listeningRef.current = false;
      activeRequestRef.current?.abort();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  // Initial setup only; language changes are synchronized in their own effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const speakResponse = (text: string) => {
    setAssistantResponse(text);
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voiceLanguage = languageRef.current;
    utterance.lang = voiceLanguage;
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const matchVoice = voices.find(
      (v) => v.lang.startsWith(voiceLanguage.slice(0, 2)) || (voiceLanguage === "hi-IN" && v.name.includes("India"))
    );
    if (matchVoice) utterance.voice = matchVoice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };
  speakRef.current = speakResponse;

  const processVoiceCommand = async (cmd: string) => {
    const text = cmd.trim();
    if (!text || activeRequestRef.current) return;

    const controller = new AbortController();
    activeRequestRef.current = controller;
    addRecentAction(text, "Sending");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
      }
      reply += decoder.decode();
      const spokenReply = reply.trim();
      if (!spokenReply) throw new Error("TARGET returned an empty reply.");
      speakResponse(spokenReply);
      addRecentAction("TARGET replied", "Complete");
      onExecuteAction?.(text);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "Voice request failed.";
        speakResponse(`Maaf kijiye, ${message}`);
        addRecentAction(message, "Failed");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  };

  const addRecentAction = (text: string, status: string) => {
    setRecentActions((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, status }, ...prev.slice(0, 2)]);
  };
  commandHandlerRef.current = processVoiceCommand;

  const toggleMic = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listeningRef.current) {
      listeningRef.current = false;
      try { recognition.stop(); } catch { /* already stopped */ }
      setIsListening(false);
    } else {
      // Mark intent before start: browsers may dispatch onstart asynchronously.
      listeningRef.current = true;
      setIsListening(true);
      try {
        recognition.start();
      } catch {
        listeningRef.current = false;
        setIsListening(false);
      }
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
          type="button"
          aria-label={isListening ? "Stop microphone" : "Start microphone"}
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