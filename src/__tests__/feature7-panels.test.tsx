import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import PanelHome from "@/components/PanelHome";
import { validatePanel, isStale, daysUntil, weatherLabel, type Panel } from "@/lib/panels";

afterEach(() => vi.unstubAllGlobals());
const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });

describe("Feature 7: panels", () => {
  it("validates each panel type", () => {
    expect(validatePanel({ kind: "weather", config: { city: "Patna" } })).toEqual({ ok: true, value: { kind: "weather", title: "Weather · Patna", config: { city: "Patna" } } });
    expect(validatePanel({ kind: "weather", config: {} }).ok).toBe(false);
    expect(validatePanel({ kind: "crypto", config: { symbol: "btc" } })).toMatchObject({ ok: true, value: { config: { symbol: "BTC", currency: "INR" } } });
    expect(validatePanel({ kind: "countdown", config: { date: "nope" } }).ok).toBe(false);
    expect(validatePanel({ kind: "ai", config: { prompt: "hi" } }).ok).toBe(false);
    expect(validatePanel({ kind: "bogus" }).ok).toBe(false);
  });

  it("knows when data is stale", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(isStale({ kind: "weather", data: {}, refreshed_at: "2026-10-29T11:30:00Z" }, now)).toBe(false);
    expect(isStale({ kind: "weather", data: {}, refreshed_at: "2026-10-29T10:00:00Z" }, now)).toBe(true);
    expect(isStale({ kind: "ai", data: null, refreshed_at: null }, now)).toBe(true);
    expect(isStale({ kind: "note", data: null, refreshed_at: null }, now)).toBe(false);
  });

  it("counts days and labels weather", () => {
    expect(daysUntil("2026-11-03", new Date("2026-10-29T10:00:00Z"))).toBe(5);
    expect(weatherLabel(0)[0]).toBe("Clear");
  });

  it("renders panels and auto-refreshes stale ones", async () => {
    const stale: Panel = { id: "w1", kind: "weather", title: "Weather · Patna", config: { city: "Patna" }, data: null, refreshed_at: null };
    const fresh = { ...stale, data: { temp: 21.2, code: 0, high: 29, low: 18, rain: 0, place: "Patna, Bihar, India" }, refreshed_at: new Date().toISOString() };
    const f = vi.fn().mockResolvedValue(ok({ panel: fresh }));
    vi.stubGlobal("fetch", f);
    render(<PanelHome initial={[stale, { id: "n1", kind: "note", title: "Note", config: { text: "Buy milk" }, data: null }]} />);
    expect(screen.getByTestId("note-body")).toHaveTextContent("Buy milk");
    await waitFor(() => expect(screen.getByTestId("weather-body")).toHaveTextContent("21°"));
    expect(f).toHaveBeenCalledWith("/api/panels/w1/refresh", { method: "POST" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("adds a countdown panel and shows errors", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ error: 'Couldn\'t find "Xyzzy"' }, 422))
      .mockResolvedValueOnce(ok({ panel: { id: "c1", kind: "countdown", title: "Trip", config: { date: "2099-01-01" }, data: {} } }, 201));
    vi.stubGlobal("fetch", f);
    render(<PanelHome initial={[]} />);
    fireEvent.click(screen.getByTestId("panel-add-open"));
    fireEvent.change(screen.getByTestId("panel-value"), { target: { value: "Xyzzy" } });
    fireEvent.click(screen.getByTestId("panel-add"));
    await waitFor(() => expect(screen.getByTestId("panel-form-error")).toHaveTextContent("Xyzzy"));
    fireEvent.click(screen.getByTestId("type-countdown"));
    fireEvent.change(screen.getByTestId("panel-value"), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByTestId("panel-title"), { target: { value: "Trip" } });
    fireEvent.click(screen.getByTestId("panel-add"));
    await waitFor(() => expect(screen.getByTestId("countdown-body")).toBeInTheDocument());
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ kind: "countdown", title: "Trip", config: { date: "2099-01-01" } });
  });
});
