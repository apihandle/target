/** Turn a failed request into one plain sentence a non-technical user understands. */
export function friendlyStatus(status: number, serverMessage?: string): string {
  const msg = (serverMessage ?? "").trim();
  if (msg && !/^request failed/i.test(msg) && msg.length <= 200 && !/[{}<>]|stack|exception|undefined/i.test(msg)) return msg;
  if (status === 401) return "You were signed out. Sign in again to keep chatting.";
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "That chat or item no longer exists.";
  if (status === 408 || status === 504) return "TARGET took too long to answer. Try again.";
  if (status === 413) return "That message or file is too big. Try a shorter message or a smaller file.";
  if (status === 429) return "Too many messages at once. Wait a minute and try again.";
  if (status === 503) return "TARGET is still being set up or is busy right now. Try again in a minute.";
  if (status >= 500) return "Something went wrong on TARGET's side. Try again.";
  return "Something went wrong. Try again.";
}

/** A thrown error (network down, aborted, server error) as a plain sentence. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Check your internet and try again.";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "Couldn't reach TARGET. Check your internet and try again.";
  if (/timeout|timed out/i.test(m)) return "TARGET took too long to answer. Try again.";
  return m && m.length <= 200 ? m : "Something went wrong. Try again.";
}
