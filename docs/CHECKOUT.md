# Store checkout (browser agent)

TARGET can buy something on a real store for the user. It never pays without a tap.

## Flow
1. The user asks to buy/order (server-checked: the model can't start a checkout on its own). The chat calls `target__checkout` with the store, start URL, items, and optionally a vault login (`login_secret_id`) and a vault card (`payment_secret_id`).
2. **Prepare job** (runs at once, nothing is paid): the browser adds the items, walks through checkout and stops on the page with the final pay / place order button. It reports `ready_to_pay` with the items, total and payment method **as the page shows them**.
   - The card is not readable by this job at all (not in `allowed_secrets`).
   - The server refuses, whatever the model says: pressing a final pay button, typing card fields, pressing Enter on a page with a pay button, and a `ready_to_pay` whose total is not on the page.
   - At the pay step the worker sends the browser state (cookies + localStorage = the cart) and the page URL. It is sealed with the server key, bound to the user and the job.
3. **Approval card** in chat: items, total, payment method, delivery. Button: *Place order*.
4. **Pay job** (only after the tap): a new browser restores the cart, opens the pay page, fills the card from the vault if the page asks (`fill_secret`, never from chat), and presses the final button **once**, only while the page shows the approved total.
   - A different total -> stops, nothing is paid, and the chat says the new total and asks again.
   - No visible total -> stops.
   - A second press is refused.
5. The outcome (order number / confirmation) is posted in chat; the sealed cart is wiped.

## Limits
- Card fields inside payment iframes (Stripe, Razorpay pop-ups) aren't reachable by the page snapshot; those checkouts stop with a clear reason.
- Captcha, OTP by SMS, 3-D Secure screens need the user; the job stops and says so (email OTPs are read from connected Gmail).
- Carts held only in server memory of a single tab may not survive the hand-over to the pay job; the job then fails with "cart is empty" and nothing is paid.

## Tests
- `src/__tests__/checkout.test.tsx`: guard, totals, tool, full worker-API flow.
- `src/__tests__/checkout-live.test.ts` (skipped unless `LIVE_CHECKOUT=1`): real saucedemo.com in a local Chromium with a scripted chooser in place of the AI. Reaches the pay page, is refused on *Finish*, shows the card ($32.39, SauceCard #31337), then a fresh browser restores the cart and reaches the same pay page. It never presses Finish.
