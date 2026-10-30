import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import ProjectList from "@/components/ProjectList";
import ProjectDetail from "@/components/ProjectDetail";
import Chat from "@/components/Chat";
import { validateProject, projectBlock } from "@/lib/projects";

const push = vi.fn(), refresh = vi.fn(), replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace }) }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Feature 6: projects", () => {
  it("validates project input", () => {
    expect(validateProject({ name: "  Goa   trip " })).toEqual({ ok: true, value: { name: "Goa trip" } });
    expect(validateProject({ name: "" }).ok).toBe(false);
    expect(validateProject({ name: "x".repeat(81) }).ok).toBe(false);
    expect(validateProject({ instructions: "Hinglish" }, true)).toEqual({ ok: true, value: { instructions: "Hinglish" } });
    expect(validateProject({}, true).ok).toBe(false);
  });

  it("builds the project system block", () => {
    expect(projectBlock(null)).toBe("");
    const b = projectBlock({ name: "Goa", instructions: "Budget 30k" });
    expect(b).toContain('"Goa"'); expect(b).toContain("Budget 30k");
  });

  it("creates a project and navigates to it", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: { id: "p1", name: "Goa", instructions: "" } }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    render(<ProjectList initial={[{ id: "p0", name: "Old", instructions: "", chats: 2 }]} />);
    expect(screen.getByText("2 chats")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-new"));
    fireEvent.change(screen.getByTestId("project-name"), { target: { value: "Goa" } });
    fireEvent.click(screen.getByTestId("project-create"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/projects/p1"));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "Goa", description: "", instructions: "" });
  });

  it("edits instructions and links new chats to the project", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: {} }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    render(<ProjectDetail project={{ id: "p1", name: "Goa", instructions: "" }} chats={[{ id: "c1", title: "Hotels" }]} />);
    expect(screen.getByTestId("pd-new-chat")).toHaveAttribute("href", "/app?p=p1");
    expect(screen.getByText("Hotels").closest("a")).toHaveAttribute("href", "/app?c=c1");
    expect(screen.getByTestId("pd-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("pd-instructions"), { target: { value: "Budget 30k" } });
    fireEvent.click(screen.getByTestId("pd-save"));
    await waitFor(() => expect(screen.getByTestId("pd-status")).toHaveTextContent("Saved"));
    expect(f.mock.calls[0][0]).toBe("/api/projects/p1");
    expect(f.mock.calls[0][1].method).toBe("PATCH");
  });

  it("chat in a project sends projectId on first message", async () => {
    const enc = new TextEncoder();
    const f = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("ok")); c.close(); } })));
    vi.stubGlobal("fetch", f);
    render(<Chat projectId="p1" projectName="Goa" />);
    expect(screen.getByText("New chat in Goa")).toBeInTheDocument();
    expect(screen.getByTestId("chat-project")).toHaveAttribute("href", "/app/projects/p1");
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ projectId: "p1", message: "hi" });
  });
});
