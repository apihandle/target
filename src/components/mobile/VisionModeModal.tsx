"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Zap, Sparkles, Scan, Camera, Upload, CheckCircle2, RotateCcw } from "lucide-react";

interface VisionModeModalProps {
  onClose: () => void;
  onAskAboutDoc: (text: string) => void;
}

type VisionPreset = "acko" | "flight" | "bill";

interface PresetDetails {
  title: string;
  badge: string;
  confidence: string;
  line1: string;
  line2: string;
  line3: string;
  actionText: string;
  insight: string;
  query: string;
}

const PRESETS: Record<VisionPreset, PresetDetails> = {
  acko: {
    title: "Acko Drive Plus Comprehensive",
    badge: "INSURANCE DOCUMENT",
    confidence: "99.4%",
    line1: "Vehicle: DL-01-AB-1234 • Honda City 2021",
    line2: "IDV: ₹7,80,000 • Zero Dep • Engine Protect",
    line3: "Expiry: 17 Nov 2026 • Premium: ₹8,940",
    actionText: "Ask TARGET to Analyze & Renew This",
    insight: "Identified expiry date and vehicle details. Autopilot can auto-renew with coupon TGT_EXCLUSIVE.",
    query: "Acko Car Insurance Policy Document (Expiry Nov 17, Premium ₹8,940)",
  },
  flight: {
    title: "IndiGo Flight 6E-204 e-Boarding Pass",
    badge: "BOARDING PASS",
    confidence: "98.9%",
    line1: "Sector: DEL (Terminal 3) → BOM (Terminal 2)",
    line2: "Departure: 18:30 IST • Seat: 12B (Aisle)",
    line3: "Gate: 42B • Status: On Time • Baggage 15kg",
    actionText: "Sync Flight to Calendar & Cab Dispatch",
    insight: "Boarding pass verified. Autopilot can reserve airport cab 2h prior and track baggage carousel.",
    query: "IndiGo 6E-204 Boarding Pass (DEL to BOM, Gate 42B, Seat 12B)",
  },
  bill: {
    title: "Skyline Rooftop Lounge & Dining Invoice",
    badge: "GST RESTAURANT INVOICE",
    confidence: "99.1%",
    line1: "Table: 14 • Guests: 2 • Server: Rahul M.",
    line2: "Subtotal: ₹4,650 • CGST+SGST 5%: ₹232.50",
    line3: "Total: ₹4,882.50 • Split: ₹2,441.25 / person",
    actionText: "Split Bill via UPI & Log to Vault Expense",
    insight: "Itemized dining receipt scanned. Can split 50/50 with contact or log to corporate reimbursement.",
    query: "Skyline Rooftop Invoice of ₹4,882.50 (Table 14, 2 guests)",
  },
};

export default function VisionModeModal({ onClose, onAskAboutDoc }: VisionModeModalProps) {
  const [flashOn, setFlashOn] = useState(false);
  const [activePreset, setActivePreset] = useState<VisionPreset>("acko");
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })
        .then((stream) => {
          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          setCameraActive(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          // Gracefully fallback to simulated HUD
          setCameraActive(false);
        });
    }

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleFlash = async () => {
    const next = !flashOn;
    setFlashOn(next);
    // Android bridge fallback if present
    const bridge = (window as unknown as { TargetAndroid?: { flashlight?: (on: boolean) => Promise<unknown> } })
      .TargetAndroid;
    if (bridge?.flashlight) {
      try {
        await bridge.flashlight(next);
        return;
      } catch {
        /* ignore */
      }
    }
    // Web MediaStream torch constraint
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && "applyConstraints" in track) {
        try {
          await (track.applyConstraints as (c: unknown) => Promise<void>)({
            advanced: [{ torch: next }],
          });
        } catch {
          /* torch not supported on this browser */
        }
      }
    }
  };

  const handleCaptureFrame = () => {
    if (videoRef.current && cameraActive) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        setCapturedImage(canvas.toDataURL("image/jpeg", 0.85));
      }
    } else {
      // Simulate frame capture
      setCapturedImage("simulated-snapshot");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === "string") {
        setCapturedImage(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const current = PRESETS[activePreset];

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between p-4 sm:p-6 select-none animate-in fade-in duration-300 overflow-y-auto">
      {/* Viewfinder Top Bar */}
      <div className="flex items-center justify-between z-20">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-status-success animate-ping" />
          <span className="text-[11px] font-mono tracking-wider text-champagne-accent font-semibold">
            {cameraActive ? "LIVE CAMERA HUD • SCANNING" : "SPATIAL OCR VISION • HUD ACTIVE"}
          </span>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            aria-label="Toggle flashlight"
            onClick={toggleFlash}
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
              flashOn
                ? "bg-champagne-gold text-obsidian-lowest border-champagne-gold"
                : "bg-obsidian-container border-white/20 text-white/60"
            }`}
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Upload photo"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-full bg-obsidian-container border border-white/20 flex items-center justify-center text-white/60 hover:text-white"
          >
            <Upload className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            type="button"
            aria-label="Close viewfinder"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-obsidian-container border border-white/20 flex items-center justify-center text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Preset Target Selector Pills */}
      <div className="flex items-center justify-center space-x-2 py-2 z-20">
        {(["acko", "flight", "bill"] as VisionPreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setActivePreset(p)}
            className={`px-3 py-1 rounded-full text-[10px] font-mono tracking-wider transition-all border ${
              activePreset === p
                ? "bg-champagne-gold text-obsidian-lowest font-semibold border-champagne-gold shadow-goldGlow"
                : "bg-obsidian-lowest text-white/60 border-white/10 hover:border-champagne-accent/30"
            }`}
          >
            {p === "acko" && "Acko Insurance"}
            {p === "flight" && "Boarding Pass"}
            {p === "bill" && "Dining Bill"}
          </button>
        ))}
      </div>

      {/* Center Camera Viewfinder with HUD Reticle */}
      <div className="relative my-auto flex items-center justify-center w-full max-w-sm mx-auto aspect-[3/4] rounded-3xl border border-white/20 overflow-hidden bg-gradient-to-b from-obsidian-low to-obsidian-lowest shadow-2xl">
        {/* Real Live Camera Video Feed if active */}
        {cameraActive && !capturedImage && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover z-0"
          />
        )}

        {/* Captured Snapshot preview if frame captured */}
        {capturedImage && capturedImage !== "simulated-snapshot" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={capturedImage}
            alt="Captured Document"
            className="absolute inset-0 w-full h-full object-cover z-0"
          />
        )}

        {/* Corner Reticle Brackets */}
        <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-champagne-accent z-10" />
        <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-champagne-accent z-10" />
        <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-champagne-accent z-10" />
        <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-champagne-accent z-10" />

        {/* Central Targeting Reticle */}
        <div className="absolute w-16 h-16 border border-champagne-accent/30 rounded-full flex items-center justify-center animate-pulse z-10 pointer-events-none">
          <div className="w-1.5 h-1.5 bg-champagne-accent rounded-full" />
        </div>

        {/* Document Auto-Bounding Box Simulation */}
        <div className="w-[86%] min-h-[58%] border-2 border-dashed border-status-success/80 rounded-xl p-3 bg-obsidian-lowest/70 backdrop-blur-[3px] flex flex-col justify-between relative shadow-lg z-10">
          <div className="flex items-center justify-between text-[9px] font-mono text-status-success bg-obsidian-lowest/90 px-2 py-0.5 rounded border border-status-success/30 w-fit">
            <Scan className="w-3 h-3 mr-1" />
            <span>{current.badge} (CONFIDENCE {current.confidence})</span>
          </div>

          <div className="space-y-1 font-mono text-[10px] text-white/90 bg-obsidian-lowest/90 p-2.5 rounded-lg border border-white/10 my-2">
            <p className="text-champagne-gold font-semibold text-[11px]">{current.title}</p>
            <p className="text-white/70">{current.line1}</p>
            <p className="text-white/60">{current.line2}</p>
            <p className="text-status-warning font-medium">{current.line3}</p>
          </div>

          <div className="flex items-center justify-between text-[9px] font-mono text-champagne-accent">
            <span className="flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-status-success" />
              <span>Optical OCR Locked</span>
            </span>
            <span>4K HDR</span>
          </div>
        </div>

        {/* Floating Contextual Insight Bubble */}
        <div className="absolute bottom-4 left-4 right-4 bg-obsidian-lowest/95 backdrop-blur-xl border border-champagne-accent/40 rounded-2xl p-3 shadow-2xl z-10">
          <div className="flex items-start space-x-2">
            <Sparkles className="w-4 h-4 text-champagne-accent shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-champagne-gold">Target OCR Context</h4>
              <p className="text-[11px] text-white/70 mt-0.5 leading-snug">
                {current.insight}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="flex flex-col items-center space-y-2.5 pt-3 pb-2 z-20 max-w-sm mx-auto w-full">
        {/* Shutter / Capture Trigger */}
        <div className="flex items-center justify-center space-x-4">
          {capturedImage ? (
            <button
              type="button"
              onClick={() => setCapturedImage(null)}
              className="px-4 py-2 rounded-full bg-obsidian-container border border-white/20 text-xs font-mono text-white/70 flex items-center space-x-1.5 hover:text-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retake</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label="Capture document frame"
              onClick={handleCaptureFrame}
              className="w-14 h-14 rounded-full border-2 border-champagne-gold p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-goldGlow"
            >
              <div className="w-full h-full rounded-full bg-champagne-gold flex items-center justify-center text-obsidian-lowest">
                <Camera className="w-6 h-6" />
              </div>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onAskAboutDoc(current.query);
            onClose();
          }}
          className="w-full py-3 rounded-full bg-champagne-gold hover:bg-white text-obsidian-lowest font-semibold text-xs transition-all shadow-goldGlow flex items-center justify-center space-x-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>{current.actionText}</span>
        </button>
      </div>
    </div>
  );
}
