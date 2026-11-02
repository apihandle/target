import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConnectorsGrid from "@/components/ConnectorsGrid";
import { connectorViews, getConnector } from "@/lib/connectors/registry";
import { SHOWN_CONNECTORS } from "@/lib/connectors/shown";
import { vercel } from "@/lib/connectors/vercel";
import { supabase } from "@/lib/connectors/supabase";
import { figma } from "@/lib/connectors/figma";

const ENV = { CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), SUPABASE_SERVICE_ROLE_KEY: "x", GITHUB_OAUTH_CLIENT_ID: "a", GITHUB_OAUTH_CLIENT_SECRET: "b", GOOGLE_OAUTH_CLIENT_ID: "c", GOOGLE_OAUTH_CLIENT_SECRET: "d" };
const res = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const shownViews = (conns = []) => SHOWN_CONNECTORS.map((id) => connectorViews(ENV, conns).find((v) => v.id === id)!);
const card = (id: string) => screen.getAllByTestId("connector-card").find((c) => c.getAttribute("data-id") === id)!;
afterEach(() => vi.unstubAllGlobals());

const VERCEL_KEY = "vck_TESTvercelTOKEN1234567890abc";
const SUPA_KEY = "sbp_0123456789abcdef0123456789abcdef01234567";
const FIGMA_KEY = "figd_TESTfigmaTOKEN_1234567890-abc";

describe("Connectors page: token connectors are shown", () => {
  it("lists GitHub, Google, Vercel, Supabase, Figma in that order", () => {
    expect([...SHOWN_CONNECTORS]).toEqual(["github", "google", "vercel", "supabase", "figma"]);
    for (const id of SHOWN_CONNECTORS) expect(getConnector(id)).toBeDefined();
    render(<ConnectorsGrid initial={shownViews()} />);
    expect(screen.getAllByTestId("connector-card").map((c) => c.getAttribute("data-id"))).toEqual(["github", "google", "vercel", "supabase", "figma"]);
  });

  it.each(["vercel", "supabase", "figma"])("%s: Connect opens one small token input, a Save button and one help link", (id) => {
    render(<ConnectorsGrid initial={shownViews()} />);
    const c = getConnector(id)!;
    expect(screen.queryByTestId("connector-key")).toBeNull();
    fireEvent.click(card(id).querySelector('[data-testid="connector-connect"]')!);
    const input = screen.getByTestId("connector-key");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("placeholder", c.apiKey!.placeholder ?? c.apiKey!.label);
    expect(screen.getByTestId("connector-save")).toHaveTextContent("Save");
    const help = screen.getByTestId("connector-help");
    expect(help).toHaveAttribute("href", c.apiKey!.helpUrl);
    expect(help).toHaveAttribute("target", "_blank");
    // Minimal: no capability lists or permission paragraphs.
    for (const cap of c.capabilities) expect(card(id)).not.toHaveTextContent(cap);
    for (const p of c.permissions) expect(card(id)).not.toHaveTextContent(p);
    fireEvent.click(screen.getByTestId("connector-cancel"));
    expect(screen.queryByTestId("connector-key")).toBeNull();
  });

  it("Save posts the Vercel token, shows Connected with the account label, and never renders the token", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: true, accountLabel: "@apihandle" }));
    vi.stubGlobal("fetch", f);
    render(<ConnectorsGrid initial={shownViews()} focus="vercel" />);
    fireEvent.change(screen.getByTestId("connector-key"), { target: { value: VERCEL_KEY } });
    fireEvent.click(screen.getByTestId("connector-save"));
    await waitFor(() => expect(card("vercel")).toHaveAttribute("data-status", "connected"));
    expect(f).toHaveBeenCalledWith("/api/connectors/vercel/connect", expect.objectContaining({ method: "POST", body: JSON.stringify({ apiKey: VERCEL_KEY }) }));
    expect(card("vercel")).toHaveTextContent("@apihandle");
    expect(document.body.innerHTML).not.toContain(VERCEL_KEY);
  });

  it("a rejected token shows the server's error and stays not connected; empty Save doesn't call the server", async () => {
    const f = vi.fn().mockResolvedValue(res(400, { error: "Figma rejected that token (it needs the current_user:read scope)." }));
    vi.stubGlobal("fetch", f);
    render(<ConnectorsGrid initial={shownViews()} focus="figma" />);
    fireEvent.click(screen.getByTestId("connector-save"));
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Paste your Figma personal access token first.");
    fireEvent.change(screen.getByTestId("connector-key"), { target: { value: FIGMA_KEY } });
    fireEvent.click(screen.getByTestId("connector-save"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Figma rejected that token"));
    expect(card("figma")).toHaveAttribute("data-status", "not_connected");
  });

  it("a connected token connector shows Disconnect, not Connect", () => {
    render(<ConnectorsGrid initial={shownViews([{ connector_id: "supabase", status: "connected", scopes: [], account_label: "2 projects reachable" }] as never)} />);
    expect(card("supabase").querySelector('[data-testid="connector-connect"]')).toBeNull();
    expect(card("supabase").querySelector('[data-testid="connector-disconnect"]')).not.toBeNull();
    expect(card("supabase")).toHaveTextContent("2 projects reachable");
  });
});

describe("token validation (provider call mocked)", () => {
  it("Vercel: GET /v2/user with a Bearer token, labels the account by username", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { user: { username: "apihandle" } }));
    await expect(vercel.apiKey!.validate(VERCEL_KEY, f)).resolves.toMatchObject({ accountLabel: "@apihandle" });
    expect(f.mock.calls[0][0]).toBe("https://api.vercel.com/v2/user");
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${VERCEL_KEY}`);
  });

  it("Vercel: a malformed token is refused without a network call; a 403 is a clean, key-free error", async () => {
    const f = vi.fn();
    await expect(vercel.apiKey!.validate("short", f)).rejects.toThrow("doesn't look like a Vercel");
    expect(f).not.toHaveBeenCalled();
    f.mockResolvedValue(res(403, { error: { message: "invalid token" } }));
    const e = await vercel.apiKey!.validate(VERCEL_KEY, f).catch((x) => x);
    expect(e.message).toBe("Vercel rejected that token.");
    expect(e.message).not.toContain(VERCEL_KEY);
  });

  it("Supabase: GET /v1/projects with a Bearer PAT, labels by reachable project count", async () => {
    const f = vi.fn().mockResolvedValue(res(200, [{ name: "a" }, { name: "b" }]));
    await expect(supabase.apiKey!.validate(SUPA_KEY, f)).resolves.toMatchObject({ accountLabel: "2 projects reachable" });
    expect(f.mock.calls[0][0]).toBe("https://api.supabase.com/v1/projects");
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${SUPA_KEY}`);
    f.mockResolvedValue(res(200, [{ name: "a" }]));
    await expect(supabase.apiKey!.validate(SUPA_KEY, f)).resolves.toMatchObject({ accountLabel: "1 project reachable" });
  });

  it("Supabase: non-sbp_ tokens are refused locally; 401 says the token was rejected", async () => {
    const f = vi.fn();
    await expect(supabase.apiKey!.validate("eyJhbGciOiJIUzI1NiJ9.anon.key", f)).rejects.toThrow("starts with sbp_");
    expect(f).not.toHaveBeenCalled();
    f.mockResolvedValue(res(401, { message: "Unauthorized" }));
    const e = await supabase.apiKey!.validate(SUPA_KEY, f).catch((x) => x);
    expect(e.message).toContain("Supabase rejected that token");
    expect(e.message).not.toContain(SUPA_KEY);
  });

  it("Figma: GET /v1/me with X-Figma-Token, labels by handle; 403 is rejected without echoing the key", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { handle: "Vikash", email: "x@y.z" }));
    await expect(figma.apiKey!.validate(FIGMA_KEY, f)).resolves.toMatchObject({ accountLabel: "Vikash" });
    expect(f.mock.calls[0][0]).toBe("https://api.figma.com/v1/me");
    expect(f.mock.calls[0][1].headers["X-Figma-Token"]).toBe(FIGMA_KEY);
    f.mockResolvedValue(res(403, { status: 403, err: "Invalid token" }));
    const e = await figma.apiKey!.validate(FIGMA_KEY, f).catch((x) => x);
    expect(e.message).toContain("Figma rejected that token");
    expect(e.message).not.toContain(FIGMA_KEY);
    await expect(figma.apiKey!.validate("has space in it 12345678901", vi.fn())).rejects.toThrow("doesn't look like a Figma");
  });

  it("Vercel list_projects calls /v10/projects with the stored token", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { projects: [{ id: "prj_1", name: "target", framework: "nextjs", updatedAt: 1 }] }));
    const t = vercel.getTools({ connector_id: "vercel", status: "connected", scopes: [], account_label: "" }).find((x) => x.name === "list_projects")!;
    const out = await t.execute(t.input.parse({}), { token: VERCEL_KEY, fetch: f, meta: {} });
    expect(out).toEqual([{ id: "prj_1", name: "target", framework: "nextjs", updatedAt: 1 }]);
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/api\.vercel\.com\/v10\/projects\?limit=20/);
  });
});
