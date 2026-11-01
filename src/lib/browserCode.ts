/**
 * Run a code job inside the user's own browser when no worker is online.
 * The code runs in a sandboxed iframe with an opaque origin (no allow-same-origin), so it cannot read
 * TARGET's cookies, storage or page, and it is thrown away after each run.
 */
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
export const RUN_LIMIT_MS = 60_000;
export const MAX_OUTPUT = 20_000;

export type CodeJob = { id: string; goal: string; language: "python" | "javascript"; code: string; inputs: { name: string; url: string }[] | null };
export type RunResult = { ok: boolean; output: string; error?: string; files: { name: string; base64: string }[] };

/** The frame's whole program. It answers one {type:"run"} message with one {type:"result"} message. */
export function runnerHtml(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const NONCE = ${JSON.stringify(nonce)};
const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }
function done(r) { parent.postMessage({ type: "result", nonce: NONCE, ...r }, "*"); }
async function fetchInputs(inputs) {
  const out = [];
  for (const f of inputs || []) { const r = await fetch(f.url); if (!r.ok) throw new Error("Couldn't load " + f.name); out.push({ name: f.name, bytes: new Uint8Array(await r.arrayBuffer()) }); }
  return out;
}
async function runPython(code, inputs) {
  await new Promise((ok, no) => { const s = document.createElement("script"); s.src = ${JSON.stringify(PYODIDE_URL)}; s.onload = ok; s.onerror = () => no(new Error("Couldn't load Python")); document.head.appendChild(s); });
  const py = await loadPyodide();
  let out = "";
  py.setStdout({ batched: (t) => { out += t + "\\n"; } });
  py.setStderr({ batched: (t) => { out += t + "\\n"; } });
  for (const f of inputs) py.FS.writeFile(f.name, f.bytes);
  try { py.FS.mkdir("out"); } catch (e) {}
  await py.loadPackagesFromImports(code);
  await py.runPythonAsync("import matplotlib\\ntry:\\n  matplotlib.use('Agg')\\nexcept Exception:\\n  pass").catch(() => {});
  const value = await py.runPythonAsync(code);
  if (value !== undefined && value !== null && !out.trim()) out = String(value);
  const files = [];
  for (const name of py.FS.readdir("out")) {
    if (name === "." || name === ".." || files.length >= MAX_FILES) continue;
    const bytes = py.FS.readFile("out/" + name);
    if (bytes.length && bytes.length <= MAX_BYTES) files.push({ name, base64: b64(bytes) });
  }
  return { output: out, files };
}
async function runJs(code, inputs) {
  let out = "";
  const files = [];
  const fmt = (a) => a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })()).join(" ");
  const log = (...a) => { out += fmt(a) + "\\n"; };
  const save = (name, data) => {
    if (files.length >= MAX_FILES) throw new Error("At most 5 files");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    files.push({ name: String(name), base64: b64(bytes) });
  };
  const input = (name) => { const f = inputs.find((x) => x.name === name); if (!f) throw new Error("No file " + name); return new TextDecoder().decode(f.bytes); };
  const fn = new Function("console", "save", "input", "files", "return (async () => {\\n" + code + "\\n})()");
  const value = await fn({ log, info: log, warn: log, error: log }, save, input, inputs.map((f) => f.name));
  if (value !== undefined && !out.trim()) out = fmt([value]);
  return { output: out, files };
}
addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || m.type !== "run" || m.nonce !== NONCE) return;
  try {
    const inputs = await fetchInputs(m.inputs);
    const r = m.language === "javascript" ? await runJs(m.code, inputs) : await runPython(m.code, inputs);
    done({ ok: true, output: r.output, files: r.files });
  } catch (err) {
    done({ ok: false, output: "", files: [], error: String((err && err.message) || err).slice(-1500) });
  }
});
parent.postMessage({ type: "ready", nonce: NONCE }, "*");
<\/script></body></html>`;
}

/** Text the AI reads back: the program's output, clipped, or a note that it printed nothing. */
export function resultText(r: RunResult): string {
  const out = r.output.trim();
  return out ? (out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}\n…(output cut)` : out) : r.files.length ? "(no printed output; files were saved)" : "(no output)";
}

/** Run one job in a fresh sandboxed frame. Resolves with the result or a timeout failure; the frame is always removed. */
export function runInBrowser(job: CodeJob, limitMs = RUN_LIMIT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0";
    let finished = false;
    const finish = (r: RunResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const m = e.data as { type?: string; nonce?: string } & Partial<RunResult>;
      if (!m || m.nonce !== nonce) return;
      if (m.type === "ready") frame.contentWindow?.postMessage({ type: "run", nonce, language: job.language, code: job.code, inputs: job.inputs ?? [] }, "*");
      if (m.type === "result") finish({ ok: !!m.ok, output: String(m.output ?? ""), error: m.error ? String(m.error) : undefined, files: Array.isArray(m.files) ? m.files.slice(0, 5) : [] });
    };
    const timer = setTimeout(() => finish({ ok: false, output: "", files: [], error: `Stopped after ${Math.round(limitMs / 1000)} seconds` }), limitMs);
    window.addEventListener("message", onMessage);
    frame.srcdoc = runnerHtml(nonce);
    document.body.appendChild(frame);
  });
}
