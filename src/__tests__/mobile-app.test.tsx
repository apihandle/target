import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TargetMobileApp from "@/components/mobile/TargetMobileApp";
import CommandHubTab from "@/components/mobile/CommandHubTab";

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
