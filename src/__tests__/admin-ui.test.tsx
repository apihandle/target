// Admin UI: every write opens a confirm dialog first and only then POSTs with confirm: true.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/admin/users" }));

import ConfirmAction from "@/components/admin/ConfirmAction";
import ControlsPanel from "@/components/admin/ControlsPanel";
import AdminNav from "@/components/admin/AdminNav";
import { ALL_ON } from "@/lib/adminConfig";

let calls: { url: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls = [];
  refresh.mockReset();
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

describe("ConfirmAction", () => {
  it("does nothing until the dialog is confirmed; Cancel sends nothing", async () => {
    render(<ConfirmAction label="Disable user" title="Disable this user?" confirmLabel="Disable" url="/api/admin/users/u/status" body={{ disabled: true }} testId="act" successText="User disabled." />);
    fireEvent.click(screen.getByTestId("act"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Disable this user?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("audit log");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByTestId("act"));
    fireEvent.click(screen.getByTestId("act-confirm"));
    await waitFor(() => expect(screen.getByTestId("act-note")).toHaveTextContent("User disabled."));
    expect(calls).toEqual([{ url: "/api/admin/users/u/status", body: { disabled: true, confirm: true } }]);
    expect(refresh).toHaveBeenCalled();
  });
  it("shows the server's error", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "You can't disable your own account." }), { status: 400 })) as unknown as typeof fetch;
    render(<ConfirmAction label="Go" title="Sure?" confirmLabel="Yes" url="/x" testId="act" />);
    fireEvent.click(screen.getByTestId("act"));
    fireEvent.click(screen.getByTestId("act-confirm"));
    await waitFor(() => expect(screen.getByTestId("act-note")).toHaveTextContent("own account"));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ControlsPanel", () => {
  const props = { announcement: { enabled: false, text: "" }, maintenance: { enabled: false, message: "" }, features: { ...ALL_ON }, cronReady: true };
  it("announcement needs text before the dialog opens, then posts the text", async () => {
    render(<ControlsPanel {...props} />);
    fireEvent.click(screen.getByTestId("ann-show"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("ann-show-note")).toHaveTextContent("Write the announcement text first.");
    fireEvent.change(screen.getByTestId("ann-text"), { target: { value: "Slow today" } });
    fireEvent.click(screen.getByTestId("ann-show"));
    fireEvent.click(screen.getByTestId("ann-show-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "/api/admin/settings", body: { key: "announcement", value: { enabled: true, text: "Slow today" }, confirm: true } });
  });
  it("a kill-switch posts only its own change", async () => {
    render(<ControlsPanel {...props} />);
    fireEvent.click(screen.getByTestId("feature-browser-toggle"));
    fireEvent.click(screen.getByTestId("feature-browser-toggle-confirm"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ key: "features", value: { browser: false }, confirm: true });
  });
  it("maintenance and run-cron go through the dialog too; cron is disabled without CRON_SECRET", async () => {
    const { rerender } = render(<ControlsPanel {...props} />);
    fireEvent.click(screen.getByTestId("mnt-on"));
    fireEvent.click(screen.getByTestId("mnt-on-confirm"));
    await waitFor(() => expect(calls[0]?.body).toEqual({ key: "maintenance", value: { enabled: true, message: "" }, confirm: true }));
    fireEvent.click(screen.getByTestId("cron-scheduled"));
    fireEvent.click(screen.getByTestId("cron-scheduled-confirm"));
    await waitFor(() => expect(calls[1]?.body).toEqual({ job: "scheduled", confirm: true }));
    rerender(<ControlsPanel {...props} cronReady={false} />);
    expect(screen.getByTestId("cron-scheduled")).toBeDisabled();
  });
});

describe("AdminNav", () => {
  it("marks the current section and lists every section", () => {
    render(<AdminNav />);
    expect(screen.getByTestId("admin-tab-users")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-tab-overview")).not.toHaveAttribute("aria-current");
    for (const t of ["errors", "jobs", "scheduled", "shares", "health", "controls", "audit"]) expect(screen.getByTestId(`admin-tab-${t}`)).toBeInTheDocument();
  });
});
