import { describe, expect, it, vi } from "vitest";
import { captionsToText, chartUrl, fileName, imageUrl, luhn, makePdf, pdfSafe, slugFor, stepsNeedApproval, vaultPreview, wrapLine, youtubeId, browserStep } from "@/lib/builtins/helpers";
import { BUILTIN_TOOLS, getBuiltin } from "@/lib/builtins/tools";
import { openVault, sealVault, vaultInput } from "@/lib/builtins/vault";
import { toOpenAITools } from "@/lib/connectors/loadTools";

const KEY = { CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as unknown as NodeJS.ProcessEnv;
const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";

describe("built-in tools", () => {
  it("are offered to the model with the target__ prefix", () => {
    const names = toOpenAITools([], new Set()).map((t) => t.function.name);
    for (const t of ["generate_image", "create_chart", "image_search", "youtube_transcript", "create_file", "create_page", "run_parallel", "list_vault", "browser_task", "read_webpage"]) expect(names).toContain(`target__${t}`);
    expect(BUILTIN_TOOLS.every((t) => t.description.length < 1000)).toBe(true);
  });
  it("builds image and chart URLs", async () => {
    const u = imageUrl("a golden lake at night", "landscape", 5);
    expect(u).toContain("image.pollinations.ai/prompt/a%20golden%20lake");
    expect(u).toContain("width=1216&height=832&seed=5");
    const out = await getBuiltin("generate_image")!.execute({ prompt: "cat", size: "square" }, {} as never) as { image_url: string };
    expect(out.image_url).toMatch(/^https:\/\/image\.pollinations\.ai\//);
    const c = chartUrl({ type: "bar", title: "Sales", labels: ["Jan", "Feb"], datasets: [{ label: "Rs", data: [3, 5] }] });
    expect(c).toMatch(/^https:\/\/quickchart\.io\/chart\?/);
    expect(JSON.parse(decodeURIComponent(c.split("&c=")[1])).data.labels).toEqual(["Jan", "Feb"]);
  });
  it("parses YouTube links and captions", () => {
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(captionsToText('{"events":[{"segs":[{"utf8":"hello "},{"utf8":"world"}]},{"segs":[{"utf8":"again"}]}]}')).toBe("hello world again");
    expect(captionsToText("<text>a &amp; b</text><text>c</text>")).toBe("a & b c");
  });
  it("makes safe file names, slugs and a real PDF", async () => {
    expect(fileName("My Resume!!.docx", "pdf")).toBe("My-Resume.pdf");
    expect(fileName("../../etc/passwd", "txt")).toBe("etcpasswd.txt");
    expect(slugFor("Goa Trip 2026!", "ab12cd")).toBe("goa-trip-2026-ab12cd");
    expect(slugFor("नमस्ते", "ab12cd")).toBe("page-ab12cd");
    expect(pdfSafe("“Hi” — ₹500 नमस्ते")).toBe('"Hi" - Rs 500 ??????');
    expect(wrapLine("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    const pdf = await makePdf("Report", "# Title\n" + "line ".repeat(500) + "\n\nend");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
  it("only read-only browser steps skip approval", () => {
    const read = [{ action: "goto", url: "https://a.com" }, { action: "extract" }].map((s) => browserStep.parse(s));
    expect(stepsNeedApproval(read)).toBe(false);
    expect(stepsNeedApproval([...read, browserStep.parse({ action: "click", selector: "#buy" })])).toBe(true);
    expect(browserStep.safeParse({ action: "eval", code: "x" }).success).toBe(false);
  });
});

describe("vault", () => {
  it("validates cards and previews without leaking", () => {
    expect(luhn("4242 4242 4242 4242")).toBe(true);
    expect(luhn("4242 4242 4242 4241")).toBe(false);
    expect(vaultInput.safeParse({ kind: "card", label: "Visa", number: "4242424242424241", expiry: "08/29" }).success).toBe(false);
    expect(vaultPreview("card", { number: "4242424242424242" })).toBe("•••• 4242");
    expect(vaultPreview("login", { username: "rahul@gmail.com" })).toBe("r•••@gmail.com");
  });
  it("seals per owner and never opens for another user", () => {
    const input = vaultInput.parse({ kind: "login", label: "Amazon", site: "amazon.in", username: "me@x.com", password: "hunter22" });
    const sealed = sealVault(U1, input, KEY);
    expect(sealed.secret_box).not.toContain("hunter22");
    expect(sealed.preview).toBe("m•••@x.com");
    expect(sealed.site).toBe("amazon.in");
    expect(openVault(U1, sealed.secret_box, KEY)).toMatchObject({ username: "me@x.com", password: "hunter22" });
    expect(() => openVault(U2, sealed.secret_box, KEY)).toThrow();
  });
});

describe("run_parallel", () => {
  it("validates 2-4 tasks", () => {
    const t = getBuiltin("run_parallel")!;
    expect(t.input.safeParse({ tasks: ["only one"] }).success).toBe(false);
    expect(t.input.safeParse({ tasks: ["a b c", "d e f"] }).success).toBe(true);
    void vi;
  });
});
