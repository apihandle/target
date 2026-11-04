import { redact } from "@/lib/connectors/safety";

/** User-safe error from a provider call. Messages are redacted and never include request headers. */
export class ConnectorError extends Error {
  constructor(message: string, public status = 502, public code: "auth" | "not_found" | "rate_limited" | "provider" | "invalid" = "provider") {
    super(redact(message).slice(0, 400));
  }
}

/** Where the user reconnects a connector (the Connectors page focuses that card). */
export const reconnectPath = (connectorId: string) => `/app/connectors?connect=${encodeURIComponent(connectorId)}`;

/**
 * The provider refused because the stored token lacks a permission (e.g. GitHub's delete_repo scope, added after
 * the user connected). Becomes a "Reconnect <app> to allow this" pause instead of a generic error.
 */
export class MissingScopeError extends ConnectorError {
  constructor(public connector: string, public connectorName: string, public scope: string) {
    super(`Reconnect ${connectorName} to allow this. TARGET's ${connectorName} access is missing the "${scope}" permission, which was added after you connected. Open Connectors (${reconnectPath(connector)}), tap Reconnect on ${connectorName} and approve the new permission; then ask again.`, 403, "auth");
  }
  get reconnectUrl() { return reconnectPath(this.connector); }
}

type Opts = Omit<RequestInit, "body"> & { body?: unknown; f?: typeof fetch; timeoutMs?: number; raw?: boolean };

/**
 * JSON fetch with a timeout. Throws ConnectorError with a short, redacted message on failure.
 * `body` objects are JSON-encoded; FormData/URLSearchParams/strings are sent as-is.
 */
export async function apiFetch<T = unknown>(url: string, opts: Opts = {}): Promise<T> {
  const { f = fetch, timeoutMs = 20000, body, headers, raw, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const isPlain = body !== undefined && !(body instanceof FormData) && !(body instanceof URLSearchParams) && typeof body !== "string";
  let r: Response;
  try {
    r = await f(url, {
      ...rest, signal: ctrl.signal,
      headers: { Accept: "application/json", ...(isPlain ? { "Content-Type": "application/json" } : {}), ...(headers as Record<string, string> | undefined) },
      body: body === undefined ? undefined : isPlain ? JSON.stringify(body) : (body as BodyInit),
    });
  } catch {
    throw new ConnectorError(`${host(url)} didn't respond in time`, 504);
  } finally { clearTimeout(timer); }
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail = String(j.message ?? j.error?.message ?? j.error_description ?? j.error ?? j.msg ?? "").slice(0, 200);
    } catch { detail = ""; }
    const code = r.status === 401 || r.status === 403 ? "auth" : r.status === 404 ? "not_found" : r.status === 429 ? "rate_limited" : "provider";
    throw new ConnectorError(`${host(url)} returned ${r.status}${detail ? `: ${detail}` : ""}`, r.status, code);
  }
  if (raw) return text as unknown as T;
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

function host(url: string) {
  try { return new URL(url).host; } catch { return "The provider"; }
}
