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

# Bookings (reservations / appointments)

Same two steps, with the final confirm button instead of pay. Tool: `target__book` (business, booking page URL, what, when, details the user gave, optional vault login / deposit card).

1. Only when the user asked to book and chose the place and the time (or a rule like "any time after 6"). The agent never picks another time: if nothing fits it fails and lists the nearest slots.
2. **Prepare job**: finds the slot, fills the details, stops before the final confirm. It reports `ready_to_confirm` with what, when, details and price as the page shows; the server checks the date/time (and price) are on the page. Final buttons ("Confirm booking", "Book appointment", "Complete reservation", and "Book now"/"Reserve" on a page with a details form) are refused here.
3. **Approval card** (`reservation`): what, when, details, price. Button: *Confirm booking*.
4. **Confirm job** (after the tap): restores the session, refills cleared fields, and presses the final button once, only while the page still shows the approved date/time (and price). A gone/changed slot stops it ("slot isn't on the page any more") and nothing is booked.

Live test: CURA Healthcare demo (katalon-demo-cura.herokuapp.com, demo login printed on its page) — facility, date and comment filled, refused on *Book Appointment*, card shows 10/12/2026, the confirm job is back on the form signed in. It never presses Book Appointment.
