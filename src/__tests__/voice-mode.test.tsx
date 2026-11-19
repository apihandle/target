import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceModeModal from "@/components/mobile/VoiceModeModal";

const speech = vi.hoisted(() => ({
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn(() => []),
}));
const battery = vi.hoisted(() => vi.fn());
let recognition: {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

vi.mock("lucide-react", () => {
  const icon = () => <svg aria-hidden="true" />;
  return {
    X: icon,
    Mic: icon,
    MicOff: icon,
    Globe: icon,
    PhoneOff: icon,
    Radio: icon,
    Sparkles: icon,
    Volume2: icon,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  battery.mockResolvedValue({ ok: true, level: 0, charging: false });
  recognition = {
    continuous: false,
    interimResults: false,
    lang: "",
    onresult: null,
    onerror: null,
    onstart: null,
    onend: null,
    start: vi.fn(() => recognition.onstart?.()),
    stop: vi.fn(),
  };
  class SpeechRecognitionMock {
    constructor() { return recognition; }
  }
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: SpeechRecognitionMock });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak: speech.speak, cancel: speech.cancel, getVoices: speech.getVoices },
  });
  Object.defineProperty(window, "TargetAndroid", { configurable: true, value: { battery } });
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text: string;
    lang = "";
    rate = 1;
    pitch = 1;
    voice?: unknown;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  });
});

describe("voice mode", () => {
  it("sends a final transcript to TARGET and speaks its reply", async () => {
    const onExecuteAction = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Hello from TARGET")));
    render(<VoiceModeModal onClose={vi.fn()} onExecuteAction={onExecuteAction} />);
    act(() => recognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "hello TARGET" }, isFinal: true }] }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({ text: "Hello from TARGET" })));
    expect(onExecuteAction).toHaveBeenCalledWith("hello TARGET");
  });

  it("speaks a useful error when the chat request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<VoiceModeModal onClose={vi.fn()} />);
    act(() => recognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "help" }, isFinal: true }] }));
    await waitFor(() => expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({ text: "Maaf kijiye, offline" })));
  });

  it("reports zero-percent battery instead of substituting a made-up level", async () => {
    render(<VoiceModeModal onClose={vi.fn()} />);
    act(() => recognition.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "battery kitni hai" }, isFinal: true }] }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(battery).not.toHaveBeenCalled();
  });

  it("restarts recognition after it ends while listening, but not after the mic is stopped", () => {
    render(<VoiceModeModal onClose={vi.fn()} />);
    expect(recognition.start).toHaveBeenCalledTimes(1);
    act(() => recognition.onend?.());
    expect(recognition.start).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Stop microphone" }));
    act(() => recognition.onend?.());
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });
});
