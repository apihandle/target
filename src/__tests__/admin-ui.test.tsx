// Admin UI: every write opens a confirm dialog first and only then POSTs with confirm: true.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/admin/users" }));

import ConfirmAction from "@/components/admin/ConfirmAction";
import ControlsPanel from "@/components/admin/ControlsPanel";
import AdminFrame from "@/components/admin/AdminFrame";
import ActivityChart from "@/components/admin/ActivityChart";
import { Donut, LineChart, SparkBars } from "@/components/admin/charts";
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

describe("AdminFrame", () => {
  const badges = { users: 1234, errors24h: 7, jobsActive: 0, scheduledActive: 3, sharesActive: 2, switchesOff: 1 };
  it("sidebar with count badges, current section, version, search, bell and status slot", () => {
    render(<AdminFrame badges={badges} version="v0.1.0 · abc1234" email="owner@example.com" statusSlot={<span data-testid="slot">OK</span>}><p>child</p></AdminFrame>);
    expect(screen.getByTestId("admin-nav-users")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-nav-users")).toHaveTextContent("1,234");
    expect(screen.getByTestId("admin-nav-errors")).toHaveTextContent("7");
    expect(screen.getByTestId("admin-nav-jobs")).not.toHaveTextContent(/\d/); // zero active jobs: no green badge
    expect(screen.getByTestId("admin-nav-controls")).toHaveTextContent("1");
    for (const t of ["dashboard", "scheduled", "shares", "activity", "health", "audit"]) expect(screen.getByTestId(`admin-nav-${t}`)).toBeInTheDocument();
    expect(screen.getByTestId("admin-version")).toHaveTextContent("abc1234");
    expect(screen.getByTestId("admin-bell")).toHaveTextContent("7");
    expect(screen.getByTestId("admin-search").closest("form")).toHaveAttribute("action", "/admin/search");
    expect(screen.getByTestId("slot")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(screen.queryByText(/payout/i)).toBeNull();
  });
  it("hamburger opens and closes the drawer on phones", () => {
    render(<AdminFrame badges={badges} version="v" email="o@x.test" statusSlot={null}><p>c</p></AdminFrame>);
    const side = screen.getByTestId("admin-sidebar");
    expect(side.className).toContain("-translate-x-full");
    fireEvent.click(screen.getByTestId("admin-menu"));
    expect(screen.getByTestId("admin-menu")).toHaveAttribute("aria-expanded", "true");
    expect(side.className).not.toContain("-translate-x-full");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(side.className).toContain("-translate-x-full");
  });
});

describe("charts", () => {
  it("render SVG with accessible labels", () => {
    const { container } = render(<div><SparkBars values={[1, 2, 3]} label="spark" /><Donut centre="10" sub="jobs" slices={[{ label: "Done", value: 7, color: "#0f0" }, { label: "Failed", value: 3, color: "#f00" }]} /><LineChart points={[{ t: "2026-11-05T00:00:00Z", a: 1, b: 1 }, { t: "2026-11-05T01:00:00Z", a: 5, b: 2 }]} labelA="messages" labelB="users" formatT={() => "t"} /></div>);
    expect(screen.getByRole("img", { name: "spark" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Done 7, Failed 3/ })).toBeInTheDocument();
    expect(container.querySelectorAll("path").length).toBeGreaterThan(1);
  });
  it("activity chart: range picker loads the new range; empty and error states", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => { calls.push({ url: String(url), body: {} }); return new Response(JSON.stringify({ buckets: [] }), { status: 200 }); }) as unknown as typeof fetch;
    render(<ActivityChart initial={{ buckets: [{ t: "2026-11-05T00:00:00Z", messages: 4, users: 2 }, { t: "2026-11-05T01:00:00Z", messages: 1, users: 1 }], error: false, capped: false }} />);
    expect(screen.getByTestId("activity-chart")).toHaveTextContent("5 messages");
    fireEvent.click(screen.getByTestId("range-7d"));
    await waitFor(() => expect(calls[0].url).toBe("/api/admin/stats/activity?range=7d"));
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeInTheDocument());
    expect(screen.getByTestId("range-7d")).toHaveAttribute("aria-pressed", "true");
  });
});
