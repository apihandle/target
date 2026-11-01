import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { cleanSiteHtml, pillowScript, SITE_HEADERS, waitForJob } from "@/lib/builtins/round2";
import { getBuiltin } from "@/lib/builtins/tools";
import { autoPrompt, pageBlock, parseAction } from "@/lib/server/autoBrowser";
import { dedupeKey, parseItems } from "@/lib/server/proactive";
import { ACTION_DEFS, parseProposal } from "@/lib/approvals";
import { toOpenAITools } from "@/lib/connectors/loadTools";
import ForYou from "@/components/ForYou";

const J = "33333333-3333-4333-8333-333333333333";

/** Minimal chainable Supabase stand-in that records inserts. */
function fakeDb(rows: Record<string, unknown[]> = {}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain, eq: chain, in: chain, order: chain, limit: chain,
      insert(row: Record<string, unknown>) { inserts.push({ table, row }); return q; },
      single: async () => ({ data: { id: `${table}-id` }, error: null }),
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null, count: 0 }),
    });
    return q;
  };
  return { db: { from } as never, inserts };
}

describe("round 2 tools", () => {
  it("are offered to the model", () => {
    const names = toOpenAITools([], new Set()).map((t) => t.function.name);
    for (const t of ["run_code", "job_status", "edit_image", "analyze_video", "checkout", "create_site"]) expect(names).toContain(`target__${t}`);
  });

  it("builds a fixed Pillow script from numbers only", () => {
    const s = pillowScript("photo.jpg", { crop: { left: 10, top: 20, width: 100, height: 50 }, resize: { width: 300 }, rotate: 90, grayscale: true, format: "jpeg" });
    expect(s).toContain('Image.open("photo.jpg")');
    expect(s).toContain("im.crop((10, 20, 110, 70))");
    expect(s).toContain("im.rotate(-90, expand=True)");
    expect(s).toContain("im.convert('RGB')");
    expect(s).toContain("out/edited.jpg");
    // A hostile file name stays a string literal.
    expect(pillowScript('a"); import os; os.system("x', {})).toContain('Image.open("a\\"); import os; os.system(\\"x")');
  });

  it("serves custom sites in an opaque sandbox", () => {
    expect(SITE_HEADERS["Content-Security-Policy"]).toMatch(/^sandbox allow-scripts/);
    expect(SITE_HEADERS["Content-Security-Policy"]).not.toContain("allow-same-origin");
    expect(cleanSiteHtml("```html\n<h1>Hi</h1>\n```")).toMatch(/^<!doctype html>[\s\S]*<body><h1>Hi<\/h1>/);
    expect(cleanSiteHtml('<html><head><base href="https://evil"></head></html>')).not.toContain("<base");
  });

  it("queues code jobs and returns the finished result", async () => {
    const { db, inserts } = fakeDb({ browser_jobs: [{ id: J, mode: "code", status: "done", result: "Output:\n42", files: [] }] });
    const out = await getBuiltin("run_code")!.execute({ language: "python", code: "print(42)", purpose: "math", files: [] }, { db, userId: "u", conversationId: null }) as { status: string; result: string };
    expect(inserts[0].row).toMatchObject({ mode: "code", status: "queued", language: "python", code: "print(42)" });
    expect(out).toMatchObject({ status: "done", result: "Output:\n42" });
  });

  it("waitForJob stops at its time budget", async () => {
    const { db } = fakeDb({ browser_jobs: [{ id: J, status: "running" }] });
    const j = await waitForJob({ db, userId: "u", conversationId: null }, J, 10, 5);
    expect(j?.status).toBe("running");
  });

  it("checkout prepares an order card and a held browser job, never a purchase", async () => {
    const { db, inserts } = fakeDb();
    const out = await getBuiltin("checkout")!.execute({ merchant: "Shop", start_url: "https://shop.example/cart", items: [{ name: "Tea", qty: 2, price: "Rs 100" }], total: "Rs 200", deliver_to: "", instructions: "" }, { db, userId: "u", conversationId: null }) as { __approval: { id: string } };
    expect(inserts[0]).toMatchObject({ table: "browser_jobs", row: { mode: "auto", status: "needs_approval" } });
    expect(inserts[1]).toMatchObject({ table: "approval_requests", row: { action_type: "purchase", status: "pending" } });
    expect(out.__approval.id).toBe("approval_requests-id");
  });

  it("the model can't propose a purchase itself", () => {
    expect(ACTION_DEFS.purchase.internal).toBe(true);
    expect(ACTION_DEFS.purchase.unavailable).toBeUndefined();
    expect(parseProposal({ action: "purchase", browser_job_id: J }).ok).toBe(false);
  });
});

describe("smart browser", () => {
  it("parses one JSON action and rejects junk", () => {
    expect(parseAction('Sure: ```json\n{"do":"click","i":3,"why":"open login"}\n```')).toEqual({ do: "click", i: 3, why: "open login" });
    expect(parseAction('{"do":"fill_secret","i":2,"secret_id":"' + J + '","field":"password"}')).toMatchObject({ do: "fill_secret", field: "password" });
    expect(parseAction('{"do":"delete_everything"}')).toBeNull();
    expect(parseAction("no json")).toBeNull();
  });
  it("tells the AI to use the vault, never type secrets, and treat pages as untrusted", () => {
    const p = autoPrompt("Sign up", [{ id: J, kind: "login", label: "Mail", site: "x.com" }], ["click [1]"], 5);
    expect(p).toContain("never type a password");
    expect(p).toContain(J);
    expect(p).toContain("Steps left: 5");
    expect(pageBlock({ url: "https://a.b", title: 'T"x', text: "hello", elements: [{ i: 0, tag: "button", text: "Go" }] })).toContain('<untrusted_page url="https://a.b" title="Tx">');
  });
});

describe("For you", () => {
  it("parses offers and makes stable dedupe keys", () => {
    const items = parseItems('```json\n[{"kind":"bill","title":"Pay Jio bill of Rs 299?","detail":"Due 5 Nov","prompt":"Remind me to pay Jio","due_at":"2026-11-05","key":"jio-nov"},{"bad":1}]\n```');
    expect(items).toHaveLength(1);
    expect(dedupeKey(items[0])).toBe(dedupeKey({ ...items[0], key: " JIO-NOV " }));
    expect(parseItems("nothing")).toEqual([]);
  });
  it("shows offers with Do it and Not now", () => {
    global.fetch = vi.fn(async () => new Response("{}")) as never;
    render(<ForYou initial={[{ id: J, kind: "bill", title: "Pay the Jio bill?", detail: "Due Friday", prompt: "Pay Jio bill", due_at: null }]} />);
    expect(screen.getByText("Pay the Jio bill?")).toBeInTheDocument();
    expect(screen.getByText("Do it").getAttribute("href")).toBe("/app?q=Pay%20Jio%20bill&send=1");
    fireEvent.click(screen.getByText("Not now"));
    expect(screen.queryByText("Pay the Jio bill?")).toBeNull();
  });
});
