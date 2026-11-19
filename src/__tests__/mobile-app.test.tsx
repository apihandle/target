import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TargetMobileApp from "@/components/mobile/TargetMobileApp";
import CommandHubTab from "@/components/mobile/CommandHubTab";
import VisionModeModal from "@/components/mobile/VisionModeModal";
import DynamicPanelsTab from "@/components/mobile/DynamicPanelsTab";
import VaultTab from "@/components/mobile/VaultTab";
import AutopilotTab from "@/components/mobile/AutopilotTab";

vi.mock("lucide-react", () => {
  const icon = () => <svg aria-hidden="true" />;
  return {
    Mic: icon,
    Camera: icon,
    ArrowUp: icon,
    Sparkles: icon,
    AlertCircle: icon,
    CheckCircle2: icon,
    ChevronRight: icon,
    Zap: icon,
    Loader2: icon,
    X: icon,
    Scan: icon,
    ScanFace: icon,
    ShieldCheck: icon,
    Eye: icon,
    EyeOff: icon,
    ShieldAlert: icon,
    Play: icon,
    Pause: icon,
    Cpu: icon,
    RefreshCw: icon,
    KeyRound: icon,
    Layers: icon,
    Check: icon,
    Plus: icon,
    Package: icon,
    DollarSign: icon,
    Plane: icon,
    MessageSquare: icon,
    Compass: icon,
    LayoutGrid: icon,
    Shield: icon,
    FileDown: icon,
    ArrowRight: icon,
    Lock: icon,
    PhoneOff: icon,
    Radio: icon,
    Volume2: icon,
    Upload: icon,
    RotateCcw: icon,
    Trash2: icon,
    Coins: icon,
    TrendingUp: icon,
    CreditCard: icon,
    Car: icon,
    Utensils: icon,
    Copy: icon,
  };
});

describe("CommandHubTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends chat message to /api/chat and streams response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("Hello! How can I assist you?")))
    );

    render(
      <CommandHubTab
        onOpenVoice={vi.fn()}
        onOpenVision={vi.fn()}
        onOpenAutopilot={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/Ask TARGET/i);
    fireEvent.change(input, { target: { value: "Check my tasks" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "Check my tasks" }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Hello! How can I assist you?")).toBeInTheDocument();
    });
  });

  it("auto-sends queuedPrompt when provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("Analyzing document details...")))
    );
    const onClear = vi.fn();

    render(
      <CommandHubTab
        onOpenVoice={vi.fn()}
        onOpenVision={vi.fn()}
        onOpenAutopilot={vi.fn()}
        queuedPrompt="Analyze Acko Policy"
        onClearQueuedPrompt={onClear}
      />
    );

    await waitFor(() => {
      expect(onClear).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          body: JSON.stringify({ message: "Analyze Acko Policy" }),
        })
      );
    });
  });
});

describe("TargetMobileApp navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("ok"))));
  });

  it("renders command hub tab by default and allows navigation", () => {
    render(<TargetMobileApp />);
    expect(screen.getByText("OBSIDIAN ENCLAVE • ONLINE")).toBeInTheDocument();

    const nav = screen.getByRole("navigation");

    // Switch to Autopilot tab
    const autopilotTabBtn = within(nav).getByRole("button", { name: "Autopilot" });
    fireEvent.click(autopilotTabBtn);
    expect(screen.getByText(/AUTOPILOT VIRTUAL BROWSER/i)).toBeInTheDocument();

    // Switch to Panels tab
    const panelsTabBtn = within(nav).getByRole("button", { name: "Panels" });
    fireEvent.click(panelsTabBtn);
    expect(screen.getByText(/DYNAMIC PANELS SYNTHESIS/i)).toBeInTheDocument();

    // Switch to Vault tab
    const vaultTabBtn = within(nav).getByRole("button", { name: "Vault" });
    fireEvent.click(vaultTabBtn);
    expect(screen.getByText(/ENCRYPTED HARDWARE VAULT/i)).toBeInTheDocument();
  });
});

describe("VisionModeModal", () => {
  it("switches presets and sends document query to chat", () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();

    render(<VisionModeModal onClose={onClose} onAskAboutDoc={onAsk} />);

    expect(screen.getByText(/Acko Drive Plus Comprehensive/i)).toBeInTheDocument();

    // Switch to Boarding Pass
    fireEvent.click(screen.getByRole("button", { name: "Boarding Pass" }));
    expect(screen.getByText(/IndiGo Flight 6E-204/i)).toBeInTheDocument();

    // Click CTA
    fireEvent.click(screen.getByRole("button", { name: /Sync Flight to Calendar/i }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("IndiGo 6E-204"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("DynamicPanelsTab", () => {
  it("synthesizes new panels and allows deploying them", async () => {
    vi.useFakeTimers();
    render(<DynamicPanelsTab />);

    const textarea = screen.getByPlaceholderText(/Compare gold spot/i);
    fireEvent.change(textarea, { target: { value: "Gold spot prices in Mumbai" } });

    fireEvent.click(screen.getByRole("button", { name: /Generate Panel/i }));

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.getByText(/Mumbai 24K Gold & Bullion Sentinel/i)).toBeInTheDocument();

    // Deploy panel
    fireEvent.click(screen.getByRole("button", { name: /Deploy Live Panel/i }));
    expect(screen.getByText(/Deployed to Hub/i)).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("VaultTab", () => {
  it("generates a single-use burner card", () => {
    render(<VaultTab />);

    expect(screen.getByText("TARGET Obsidian Enclave")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Generate Burner Card/i }));

    expect(screen.getByText("Disposable Autopilot Burner")).toBeInTheDocument();
    expect(screen.getByText("ONE-TIME BURNER")).toBeInTheDocument();
  });
});

describe("AutopilotTab", () => {
  it("switches between active tasks and updates virtual DOM preview", () => {
    render(<AutopilotTab onTakeOver={vi.fn()} onApprovePayment={vi.fn()} />);

    expect(screen.getByText("Acko Drive Secure Plus (Comprehensive)")).toBeInTheDocument();

    // Switch to Flight 6E-204
    fireEvent.click(screen.getByRole("button", { name: /Flight 6E-204/i }));
    expect(screen.getByText("IndiGo Flight 6E-204 Seat Selection")).toBeInTheDocument();

    // Switch to Skyline Table
    fireEvent.click(screen.getByRole("button", { name: /Skyline Table/i }));
    expect(screen.getByText("Skyline Rooftop Lounge Table Reservation")).toBeInTheDocument();
  });
});
