/** Turn a worker log line ("click [12]: open the pricing page") into words a person reads. */
const VERB: Record<string, string> = {
  click: "Clicking", fill: "Typing", fill_secret: "Signing in", select: "Choosing an option", press: "Pressing a key",
  goto: "Opening a page", scroll: "Scrolling", wait: "Waiting for the page", done: "Finished", fail: "Stopped",
};

export function stepText(line: string): string {
  const m = line.match(/^([a-z_]+)(?: \[\d+\])?(?::\s*(.*))?$/);
  if (!m || !(m[1] in VERB)) return line;
  const why = (m[2] ?? "").trim();
  return why ? why.charAt(0).toUpperCase() + why.slice(1) : VERB[m[1]];
}

export const isActive = (status: string) => status === "queued" || status === "running";
