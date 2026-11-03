import { normalizeSite } from "@/lib/sessions";
import { reportLangHint, type Lang } from "@/lib/lang";
import type { AutoAction, Snapshot } from "@/lib/server/autoBrowser";

/**
 * Buying on a real store in two browser jobs, with the user's tap in between:
 *  1. "prepare": add the items to the cart, go through checkout and STOP on the page with the final pay button.
 *     The agent reports what that page shows (items, total, payment method) with ready_to_pay. Paying, typing a
 *     card and pressing the final button are blocked here on the server, whatever the model says.
 *  2. "pay": only after the user taps Place order on the approval card. A new browser restores the cart (cookies +
 *     localStorage), opens the pay page, fills the card from the vault if the page asks, and presses the pay button
 *     ONCE, and only while the page still shows the approved total. A different total stops it and asks again.
 */
export type CheckoutPhase = "prepare" | "pay";
export type CheckoutItem = { name: string; qty?: number; price?: string };
export type CheckoutSummary = { items: CheckoutItem[]; total: string; payment: string; pay_i?: number; what?: string; when?: string; details?: string };
/** "order" = store checkout; "booking" = reservation / appointment (same two steps, final confirm instead of pay). */
export type CheckoutKind = "order" | "booking";
export type CheckoutInputs = {
  phase: CheckoutPhase; kind?: CheckoutKind; merchant: string; site: string; items: CheckoutItem[];
  /** Booking: what to book (service, room, table for 2) and the user's chosen time or rule ("Fri 7:30 pm", "any time after 6"). */
  what?: string; when?: string;
  deliver_to?: string; details?: string; login_secret_id?: string | null; payment_secret_id?: string | null; lang?: Lang | null;
  goal?: string;
  /** Set by the server when the prepare job reached the pay page (validated against that page). */
  pending?: CheckoutSummary | null;
  /** Sealed browser state (cookies + localStorage) and the pay page URL, captured at the pay step. */
  state_box?: string | null; pay_url?: string | null;
  /** On the pay job: what the user approved. */
  approved?: CheckoutSummary | null; prepare_job_id?: string | null;
};

// ------------------------------------------------------------------ user intent (server check)
const BUY = [
  /\b(buy|order|purchase|checkout|check out|add to (my )?cart|shop)\b/i,
  /\b(kharid\w*|khareed\w*|mangwa\w*|mangao|order kar\w*|le lo|lelo|le do|ledo|cart me\w*)\b/i,
];
/** Did the user's own recent message ask to buy / order something? The model can't start a checkout on its own. */
export function userAskedToBuy(userTexts: string[] | null | undefined): boolean {
  return (userTexts ?? []).slice(-3).some((t) => BUY.some((r) => r.test((t ?? "").slice(0, 2000))));
}

const BOOK = [
  /\b(book|booking|reserve|reservation|appointment|table for|schedule (a|an|my)|slot)\b/i,
  /\b(book kar\w*|appointment (le|lo|chahiye|fix)\w*|table (book|reserve)\w*|slot (book|le)\w*)\b/i,
];
/** Did the user's own recent message ask to book / reserve something? */
export function userAskedToBook(userTexts: string[] | null | undefined): boolean {
  return (userTexts ?? []).slice(-3).some((t) => BOOK.some((r) => r.test((t ?? "").slice(0, 2000))));
}

// ------------------------------------------------------------------ the final button
/** Buttons that pay / place the order. Pressed only in the pay phase, once, at the approved total. */
export const PAY_BUTTON = /^\s*pay\s*$|\b(place (my |your )?order|pay now|pay securely|pay\s*(₹|rs\.?|inr|\$|€|£|usd)?\s*\d|confirm (and pay|order|purchase|payment|booking)|complete (order|purchase|payment|checkout)|submit (order|payment)|finish|buy now|make payment|order now|place order and pay)\b/i;

type El = { tag?: string; type?: string; text?: string; name?: string };
/** A button (not a radio / checkbox / label for choosing a method) whose text pays or places the order. */
export function isPayElement(e: El | undefined | null): boolean {
  if (!e) return false;
  if (e.tag === "label" || e.tag === "select" || e.tag === "textarea" || (e.tag === "input" && /^(radio|checkbox|text|email|tel|number|password)$/i.test(e.type ?? ""))) return false;
  const t = `${e.text ?? ""}`.trim() || `${e.name ?? ""}`.trim();
  return !!t && PAY_BUTTON.test(t);
}

/** Final booking buttons. "Book now" / "Reserve" alone only count on a page with a details form (else they just open one). */
const CONFIRM_STRONG = /\b(confirm( (my |the |your )?(booking|reservation|appointment|and book|details))?|complete (booking|reservation|appointment)|finali[sz]e|submit (booking|reservation|request|appointment)|place (reservation|booking)|book appointment|schedule (event|appointment|meeting))\b/i;
const CONFIRM_SOFT = /^\s*(book|reserve|schedule|submit|book now|reserve now|book it|book table|reserve table|make (a )?(reservation|booking|appointment)|request booking)\s*$/i;

const isField = (e: El) => e.tag === "textarea" || e.tag === "select" || (e.tag === "input" && /^(|text|email|tel|date|datetime-local|time|number)$/i.test(e.type ?? ""));
export function isConfirmElement(e: El | undefined | null, page: { elements: El[] }): boolean {
  if (!e || e.tag === "label" || isField(e) || (e.tag === "input" && /^(radio|checkbox)$/i.test(e.type ?? ""))) return false;
  const t = `${e.text ?? ""}`.trim() || `${e.name ?? ""}`.trim();
  if (!t) return false;
  if (CONFIRM_STRONG.test(t) || PAY_BUTTON.test(t)) return true;
  return CONFIRM_SOFT.test(t) && page.elements.filter(isField).length >= 2;
}

/** Final button for this kind of job. */
export const isFinalElement = (kind: CheckoutKind | undefined, e: El | undefined | null, page: { elements: El[] }) =>
  kind === "booking" ? isConfirmElement(e, page) : isPayElement(e);

// ------------------------------------------------------------------ slot (date / time) on the page
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Times ("19:30", "7:30 pm" -> 19:30, "7 pm" -> 19:00) and dates (day + month) found in a text, as comparable tokens. */
export function slotTokens(text: string): { times: Set<string>; dates: Set<string> } {
  const t = (text ?? "").toLowerCase();
  const times = new Set<string>(), dates = new Set<string>();
  for (const m of t.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d/])/g)) {
    if (!m[2] && !m[3]) continue;
    let h = Number(m[1]); const min = m[2] ?? "00";
    if (h > 23 || Number(min) > 59) continue;
    if (m[3]?.startsWith("p") && h < 12) h += 12;
    if (m[3]?.startsWith("a") && h === 12) h = 0;
    times.add(`${h}:${min}`);
  }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(`${Number(m[3])}/${Number(m[2])}`);
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) { dates.add(`${Number(m[1])}/${Number(m[2])}`); dates.add(`${Number(m[2])}/${Number(m[1])}`); }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g)) dates.add(`${Number(m[1])}/${MONTHS.indexOf(m[2]) + 1}`);
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) dates.add(`${Number(m[2])}/${MONTHS.indexOf(m[1]) + 1}`);
  return { times, dates };
}

/** Does the page (text, buttons and filled fields) still show this slot? Every time and date in `when` must be there. */
export function slotOnPage(snap: Pick<Snapshot, "text" | "elements">, when: string): "yes" | "no" | "unknown" {
  const want = slotTokens(when);
  if (!want.times.size && !want.dates.size) return "unknown";
  const seen = slotTokens([snap.text, ...snap.elements.map((e) => e.text ?? "")].join("\n"));
  const ok = [...want.times].every((x) => seen.times.has(x)) && (!want.dates.size || [...want.dates].some((x) => seen.dates.has(x)));
  return ok ? "yes" : "no";
}

// ------------------------------------------------------------------ amounts
/** "₹1,299.00" -> 1299, "$32.39" -> 32.39; null when there is no number. */
export function parseAmount(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const TOTAL_WORD = /\b(sub[- ]?total|items? total|cart total|product total|price total|grand total|order total|total amount|amount payable|amount to pay|total payable|you pay|to pay|total|pay)\b/gi;
const PARTIAL = /^(sub|item|cart|product|price)/i;
const LEAD_AMOUNT = /^\s*[:\-–]?\s*(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

/**
 * Amounts the page shows as the total to pay: right after a "Total" / "Grand total" / "Pay" label on the same line
 * (or alone on the next line, as in a table). Subtotals and item totals don't count.
 */
export function totalsOnPage(snap: Pick<Snapshot, "text" | "elements">): number[] {
  const sources = [snap.text ?? "", ...snap.elements.map((e) => e.text ?? "")];
  const out = new Set<number>();
  for (const src of sources) {
    for (const m of src.matchAll(TOTAL_WORD)) {
      if (PARTIAL.test(m[0])) continue;
      const rest = src.slice((m.index ?? 0) + m[0].length);
      const [line, next = ""] = rest.split("\n", 2);
      let a = line.match(LEAD_AMOUNT) ?? line.slice(0, 30).match(/(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
      if (!a && /^[\s:\-–]*$/.test(line)) a = next.match(LEAD_AMOUNT);
      if (a) { const n = parseAmount(a[1]); if (n !== null && n > 0) out.add(n); }
    }
  }
  return [...out];
}

/** Does the page still show this total? "unknown" when the page shows no total at all. */
export function totalMatches(snap: Pick<Snapshot, "text" | "elements">, total: string): "yes" | "no" | "unknown" {
  const want = parseAmount(total);
  const seen = totalsOnPage(snap);
  if (want === null || !seen.length) return "unknown";
  return seen.some((n) => Math.abs(n - want) < 0.005) ? "yes" : "no";
}

/** The largest total-like amount on the page, for "the total is now X" (largest = grand total, usually). */
export function pageTotalText(snap: Pick<Snapshot, "text" | "elements">): string | null {
  const seen = totalsOnPage(snap);
  return seen.length ? String(Math.max(...seen)) : null;
}

// ------------------------------------------------------------------ goals
export function prepareGoal(c: CheckoutInputs): string {
  if (c.kind === "booking") return bookingPrepareGoal(c);
  const items = c.items.map((i) => `${i.qty ?? 1} x ${i.name}`).join(", ");
  const login = c.login_secret_id ? ` If the store needs you to sign in, sign in with vault item ${c.login_secret_id} (fill_secret username / password).` : " If the store needs an account, continue as guest; if guest checkout isn't possible, use fail and say so.";
  const parts = [
    `On ${c.site} (${c.merchant}): add to the cart ${items}, open the cart and go through checkout up to the page with the final pay / place order button, then STOP there.`,
    c.deliver_to ? `Delivery details the user gave: ${c.deliver_to}.` : "",
    c.details ? `Other details the user gave for the checkout form: ${c.details}.` : "",
    login,
    "If a required field needs information you were not given (address, phone, name), use fail and say exactly what is needed. Never invent personal details.",
    "Pick the cheapest standard shipping if asked. Don't add anything else (no insurance, gift wrap, subscriptions, offers).",
    "Never type a card number and never press the final pay / place order / finish button in this task: the user approves the total first.",
    'When the page with the final pay / place order button shows the order summary, reply {"do":"ready_to_pay","i":<that button>,"items":[{"name":"...","qty":1,"price":"as shown"}],"total":"exactly as the page shows","payment":"payment method as the page shows (empty if none shown)"}.',
    "If an item is out of stock or its name differs a lot, use fail and say what the store shows.",
  ];
  const hint = reportLangHint(c.lang);
  return `${parts.filter(Boolean).join(" ")}${hint ? ` ${hint}` : ""}`.slice(0, 2400);
}

export function payGoal(c: CheckoutInputs): string {
  if (c.kind === "booking") return bookingConfirmGoal(c);
  const ap = c.approved;
  const card = c.payment_secret_id ? ` If the page asks for card details, fill them with fill_secret from vault item ${c.payment_secret_id} (fields number, expiry, cvc, name).` : " Use the payment method already selected on the page; if it asks for a card, use fail (no card was given).";
  const parts = [
    `The user approved paying ${ap?.total ?? "?"} at ${c.merchant} for ${(ap?.items ?? c.items).map((i) => `${i.qty ?? 1} x ${i.name}`).join(", ")}.`,
    `This page is the checkout. Check the total is still ${ap?.total ?? "?"}; if it is different, use fail and say the new total.`,
    card,
    c.login_secret_id ? ` If the store asks to sign in again, use vault item ${c.login_secret_id}.` : "",
    "Then press the final pay / place order button ONCE. Never press it twice.",
    "Use done when the store shows the order confirmation, with the order number and the total it shows. If the cart is empty or the page expired, use fail and say so.",
  ];
  const hint = reportLangHint(c.lang);
  return `${parts.filter(Boolean).join(" ")}${hint ? ` ${hint}` : ""}`.slice(0, 2000);
}

function bookingPrepareGoal(c: CheckoutInputs): string {
  const login = c.login_secret_id ? ` If the site needs you to sign in, sign in with vault item ${c.login_secret_id} (fill_secret username / password).` : "";
  const parts = [
    `On ${c.site} (${c.merchant}): book ${c.what || "what the user asked"} for ${c.when || "the time the user asked"}.`,
    "Find the available slots and pick ONLY one that fits the user's time exactly (or their rule, e.g. 'any time after 6'). If none fits, use fail and list the nearest available slots with dates and times; never pick a different time yourself.",
    c.details ? `Details the user gave for the booking form: ${c.details}.` : "",
    login,
    "If a required field needs information you were not given (name, phone, email), use fail and say exactly what is needed. Never invent personal details. Don't add extras (insurance, upgrades, newsletters).",
    "Never press the final confirm / book / reserve button in this task and never type a card number: the user approves first.",
    'When the details are filled and the page shows the final confirm button, reply {"do":"ready_to_confirm","i":<that button>,"what":"what is being booked, as the page shows","when":"date and time exactly as the page shows","details":"name / party size / other details as filled","price":"price or deposit as the page shows (empty if none)"}.',
  ];
  const hint = reportLangHint(c.lang);
  return `${parts.filter(Boolean).join(" ")}${hint ? ` ${hint}` : ""}`.slice(0, 2400);
}

function bookingConfirmGoal(c: CheckoutInputs): string {
  const ap = c.approved;
  const card = c.payment_secret_id ? ` If the page asks for card details for a deposit, fill them with fill_secret from vault item ${c.payment_secret_id} (fields number, expiry, cvc, name).` : " If the page asks for a card, use fail (no card was given).";
  const parts = [
    `The user approved booking ${ap?.what || c.what || "?"} at ${c.merchant} for ${ap?.when || "?"}${ap?.total ? ` (price ${ap.total})` : ""}.`,
    `This page is the booking form. Check it still shows ${ap?.when || "that time"}${ap?.total ? ` and ${ap.total}` : ""}; if anything differs, use fail and say what the page shows now. If a field was cleared, fill it again with: ${ap?.details || c.details || "the details shown before"}.`,
    card,
    c.login_secret_id ? ` If the site asks to sign in again, use vault item ${c.login_secret_id}.` : "",
    "Then press the final confirm / book button ONCE. Never press it twice.",
    "Use done when the site shows the booking confirmation, with the reference number, date and time it shows.",
  ];
  const hint = reportLangHint(c.lang);
  return `${parts.filter(Boolean).join(" ")}${hint ? ` ${hint}` : ""}`.slice(0, 2000);
}

// ------------------------------------------------------------------ server guard on every step
export const PAY_PRESSED = "final button pressed (once)";
const CARD_FIELDS = new Set(["number", "expiry", "cvc"]);

export type GuardResult = { action: AutoAction; pays?: boolean } | { retry: string };

/**
 * The server's check on each step of a checkout job, whatever the model decided. Prepare: never pay, never type a
 * card, never press Enter on a page with a pay button; ready_to_pay must match the page. Pay: the final button is
 * pressed once and only while the approved total is on the page.
 */
export function guardCheckout(c: CheckoutInputs, a: AutoAction, snap: Snapshot, log: string[]): GuardResult {
  const booking = c.kind === "booking";
  const el = "i" in a ? snap.elements.find((e) => e.i === (a as { i: number }).i) : undefined;
  const final = (e: typeof el) => isFinalElement(c.kind, e, snap);
  const finalOnPage = snap.elements.some((e) => final(e));
  const ready = booking ? "ready_to_confirm" : "ready_to_pay";
  if (c.phase === "prepare") {
    if (a.do === "click" && final(el))
      return { retry: booking
        ? `Blocked: "${el?.text ?? ""}" is the final confirm button and this task must not press it. If the details are filled, reply ready_to_confirm with that button's number, what, when, details and price as the page shows.`
        : `Blocked: "${el?.text ?? ""}" is the final pay button and this task must not press it. If this page shows the order summary, reply ready_to_pay with that button's number, the items, the total and the payment method as shown.` };
    if (a.do === "fill_secret" && CARD_FIELDS.has(a.field)) return { retry: `Blocked: card details are entered only after the user approves. Stop at this page with ${ready}.` };
    if (a.do === "press" && a.key === "Enter" && finalOnPage) return { retry: `Blocked: pressing Enter here could submit it. Use ${ready} if this is the final page.` };
    if (a.do === "ready_to_pay" || a.do === "ready_to_confirm") {
      if (a.do !== ready) return { retry: `Use ${ready} for this task.` };
      if (!el) return { retry: `${ready} needs the number of the final button on this page.` };
      if (a.do === "ready_to_confirm") {
        const slot = slotOnPage(snap, a.when);
        if (slot === "unknown") return { retry: "Give the date and time exactly as the page shows them (e.g. 'Fri 7 Nov, 7:30 PM')." };
        if (slot === "no") return { retry: `The page doesn't show ${a.when}. Select that slot (or copy the date and time exactly as shown) before ready_to_confirm.` };
        if (a.price && totalMatches(snap, a.price) === "no") return { retry: `The price ${a.price} isn't what this page shows (${pageTotalText(snap)}).` };
        return { action: a };
      }
      const seen = totalMatches(snap, a.total);
      if (seen === "unknown") return { retry: "The page doesn't show a total yet. Go on to the page that shows the order total before ready_to_pay." };
      if (seen === "no") return { retry: `The total ${a.total} isn't what this page shows (${pageTotalText(snap)}). Copy the total exactly as the page shows it.` };
      if (!a.items.length) return { retry: "List the items exactly as the page shows them." };
      return { action: a };
    }
    if (a.do === "done") return { retry: `This task ends with ${ready} on the final page (or fail with the reason), not done.` };
    return { action: a };
  }
  // pay / confirm phase (approved)
  const ap = c.approved;
  const pressed = log.includes(PAY_PRESSED);
  if (a.do === "ready_to_pay" || a.do === "ready_to_confirm") return { retry: "The user already approved. Press the final button (click) instead." };
  const isFinal = (a.do === "click" && final(el)) || (a.do === "press" && a.key === "Enter" && finalOnPage);
  if (!isFinal) return { action: a };
  if (pressed) return { action: { do: "done", result: booking
    ? "The confirm button was already pressed once, so I stopped instead of pressing it again. Check the confirmation email or your bookings on the site."
    : "The pay button was already pressed once, so I stopped instead of pressing it again. Check the store's confirmation email or order history." } };
  if (booking) {
    const slot = slotOnPage(snap, ap?.when ?? "");
    if (slot !== "yes") return { action: { do: "fail", reason: slot === "no" ? "SLOT_CHANGED" : "SLOT_UNSEEN" } };
    if (ap?.total && totalMatches(snap, ap.total) === "no") return { action: { do: "fail", reason: `TOTAL_CHANGED ${pageTotalText(snap) ?? "?"}` } };
    return { action: a, pays: true };
  }
  const seen = totalMatches(snap, ap?.total ?? "");
  if (seen === "no") return { action: { do: "fail", reason: `TOTAL_CHANGED ${pageTotalText(snap) ?? "?"}` } };
  if (seen === "unknown") return { action: { do: "fail", reason: "TOTAL_UNSEEN" } };
  return { action: a, pays: true };
}

// ------------------------------------------------------------------ inputs
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
const uuidOrNull = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

function items(v: unknown): CheckoutItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((x) => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o.name !== "string" || !o.name.trim()) return [];
    const qty = typeof o.qty === "number" && o.qty >= 1 && o.qty <= 99 ? Math.floor(o.qty) : undefined;
    return [{ name: o.name.slice(0, 120), ...(qty ? { qty } : {}), ...(typeof o.price === "string" && o.price ? { price: o.price.slice(0, 30) } : {}) }];
  });
}

function summary(v: unknown): CheckoutSummary | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.total !== "string") return null;
  return {
    items: items(o.items), total: o.total.slice(0, 40), payment: str(o.payment, 120) ?? "", ...(typeof o.pay_i === "number" ? { pay_i: o.pay_i } : {}),
    ...(typeof o.what === "string" ? { what: o.what.slice(0, 200) } : {}), ...(typeof o.when === "string" ? { when: o.when.slice(0, 120) } : {}), ...(typeof o.details === "string" ? { details: o.details.slice(0, 300) } : {}),
  };
}

/** Read { checkout } out of a browser job's inputs. */
export function checkoutOf(inputs: unknown): CheckoutInputs | null {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return null;
  const c = (inputs as { checkout?: Record<string, unknown> }).checkout;
  if (!c || (c.phase !== "prepare" && c.phase !== "pay") || typeof c.site !== "string" || typeof c.merchant !== "string") return null;
  return {
    phase: c.phase, kind: c.kind === "booking" ? "booking" : "order", merchant: c.merchant.slice(0, 80), site: c.site, items: items(c.items),
    what: str(c.what, 200), when: str(c.when, 120),
    deliver_to: str(c.deliver_to, 300), details: str(c.details, 400),
    login_secret_id: uuidOrNull(c.login_secret_id), payment_secret_id: uuidOrNull(c.payment_secret_id),
    lang: c.lang === "hinglish" || c.lang === "hindi" || c.lang === "english" ? c.lang : null,
    goal: str(c.goal, 2400), pending: summary(c.pending), state_box: str(c.state_box, 600000) ?? null,
    pay_url: str(c.pay_url, 2000) ?? null, approved: summary(c.approved), prepare_job_id: uuidOrNull(c.prepare_job_id),
  };
}

export function storeSite(url: string): string | null {
  try { return normalizeSite(new URL(url).hostname); } catch { return null; }
}

// ------------------------------------------------------------------ chat lines
export function checkoutPost(c: Pick<CheckoutInputs, "phase" | "merchant" | "lang" | "kind">, ok: boolean, detail: string): string {
  const en = c.lang === "english";
  if (c.kind === "booking") return bookingPost(c, ok, detail, en);
  if (c.phase === "prepare") {
    if (ok) return en ? `🛒 **Checkout ready at ${c.merchant}.** I stopped at the pay step. Check the card below; nothing is paid until you tap Place order.` : `🛒 **${c.merchant} pe checkout ready hai.** Pay step pe ruk gaya hoon. Neeche card check karo; Place order tap karne se pehle kuch pay nahi hoga.`;
    return en ? `⚠️ **Couldn't get to checkout at ${c.merchant}.** Nothing was paid. ${detail}` : `⚠️ **${c.merchant} pe checkout tak nahi pahunch paya.** Kuch pay nahi hua. ${detail}`;
  }
  const changed = detail.match(/^TOTAL_CHANGED (\S+)/);
  if (changed) return en ? `⚠️ **The total at ${c.merchant} changed** (the page now shows ${changed[1]}), so I did not pay. Nothing was charged. Say so if you want me to prepare the order again at the new total.` : `⚠️ **${c.merchant} pe total badal gaya** (ab page pe ${changed[1]} dikh raha hai), isliye pay nahi kiya. Kuch charge nahi hua. Naye total pe order chahiye to bolo, main dobara ready kar dunga.`;
  if (/^TOTAL_UNSEEN/.test(detail)) return en ? `⚠️ **Couldn't see the total at ${c.merchant} before paying,** so I stopped. Nothing was paid.` : `⚠️ **${c.merchant} pe pay karne se pehle total nahi dikha,** isliye ruk gaya. Kuch pay nahi hua.`;
  if (ok) return en ? `✓ **Order placed at ${c.merchant}.**` : `✓ **${c.merchant} pe order place ho gaya.**`;
  return en ? `⚠️ **Payment at ${c.merchant} didn't finish.** ${detail}` : `⚠️ **${c.merchant} pe payment poora nahi hua.** ${detail}`;
}

function bookingPost(c: Pick<CheckoutInputs, "phase" | "merchant">, ok: boolean, detail: string, en: boolean): string {
  if (c.phase === "prepare") {
    if (ok) return en ? `📅 **Booking ready at ${c.merchant}.** I filled the details and stopped before the final confirm. Check the card below; nothing is booked until you tap Confirm booking.` : `📅 **${c.merchant} pe booking ready hai.** Details bhar di hain, final confirm se pehle ruk gaya hoon. Neeche card check karo; Confirm booking tap karne se pehle kuch book nahi hoga.`;
    return en ? `⚠️ **Couldn't get the booking ready at ${c.merchant}.** Nothing was booked. ${detail}` : `⚠️ **${c.merchant} pe booking ready nahi ho payi.** Kuch book nahi hua. ${detail}`;
  }
  if (/^SLOT_(CHANGED|UNSEEN)/.test(detail)) return en ? `⚠️ **The slot at ${c.merchant} isn't on the page any more** (it may have been taken or changed), so I did not confirm. Nothing was booked. Say so and I'll look for slots again.` : `⚠️ **${c.merchant} pe woh slot ab page pe nahi dikh raha** (shayad kisi ne le liya ya badal gaya), isliye confirm nahi kiya. Kuch book nahi hua. Bolo to main dobara slot dhoondh deta hoon.`;
  const changed = detail.match(/^TOTAL_CHANGED (\S+)/);
  if (changed) return en ? `⚠️ **The price at ${c.merchant} changed** (now ${changed[1]}), so I did not confirm. Nothing was booked or charged.` : `⚠️ **${c.merchant} pe price badal gaya** (ab ${changed[1]}), isliye confirm nahi kiya. Kuch book ya charge nahi hua.`;
  if (ok) return en ? `✓ **Booked at ${c.merchant}.**` : `✓ **${c.merchant} pe booking ho gayi.**`;
  return en ? `⚠️ **The booking at ${c.merchant} didn't finish.** ${detail}` : `⚠️ **${c.merchant} pe booking poori nahi hui.** ${detail}`;
}
