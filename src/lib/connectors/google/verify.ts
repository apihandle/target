/** "https://www.Example.com/x" -> "example.com"; null for anything that isn't a plain domain. */
export function siteDomain(site: string): string | null {
  let h = site.trim().toLowerCase();
  try { if (/^https?:\/\//.test(h)) h = new URL(h).hostname; } catch { return null; }
  h = h.replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
}

/** Pull an OTP code and/or a verification link (on the sender's own domain) out of an email. */
export function extractVerification(text: string, domain: string): { code?: string; link?: string } {
  const out: { code?: string; link?: string } = {};
  const kw = /(?:code|otp|pin|passcode|verification|verify|one[- ]time|confirm)(?:\W+(?:is|code|:|=|your|the)){0,3}\W{0,10}(\d{3}[- ]\d{3}|(?=[A-Z0-9]*\d)[A-Z0-9]{4,8})\b/i;
  const near = text.match(kw) ?? text.match(/\b(\d{6})\b/);
  if (near) out.code = near[1].replace(/[- ]/g, "");
  const links = text.match(/https:\/\/[^\s"'<>)]+/g) ?? [];
  const link = links.find((l) => {
    try {
      const h = new URL(l).hostname.toLowerCase();
      return (h === domain || h.endsWith("." + domain)) && /verif|confirm|activate|magic|token|login|auth|reset|password|recover/i.test(l);
    } catch { return false; }
  });
  if (link) out.link = link.slice(0, 1000);
  return out;
}
