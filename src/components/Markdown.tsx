"use client";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** A fenced code block with its language label and a copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child && typeof child === "object" && "props" in child ? (child as { props: { className?: string } }).props.className : "") ?? "";
  const lang = /language-([\w+-]+)/.exec(cls)?.[1];
  const code = textOf(children).replace(/\n$/, "");
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="code-block my-3 overflow-hidden rounded-xl border border-line bg-black/30">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span>{lang ?? "code"}</span>
        <button type="button" data-testid="code-copy" onClick={copy} className="rounded px-1.5 py-0.5 hover:bg-surface-3 hover:text-ink">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** Chat markdown: GFM, copyable code blocks, scrollable tables, links that open in a new tab. */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        table: ({ children }) => <div className="table-wrap my-3 overflow-x-auto rounded-xl border border-line"><table>{children}</table></div>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
