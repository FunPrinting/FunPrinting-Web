# Payments

Customers pay through **Razorpay Payment Links**: the server creates a link for an exact amount, the browser is redirected to Razorpay's hosted page, and Razorpay sends the customer back to the site. No amount is ever taken from the browser.

Code: `src/lib/payments/`. Models: `Payment`, `WebhookEvent`, and the payment fields on `Order`.

## Flow

```
upload-file ──► receipt (signed: url, pages, mime)
     │
POST /api/checkout ──► Order (pending_payment) + Payment (created) + Razorpay Payment Link
     │                                     │
     ▼                                     ▼
browser → Razorpay hosted page ─ pays ─► GET /api/payments/callback ──► /payment/status/<ref>
                                   └───► POST /api/payments/webhook (payment_link.paid)
                                         daily cron /api/cron/reconcile-payments
                                                    │
                                     settlePaid() → runFulfilment()
```

1. **Upload.** `/api/upload-file` counts pages on the server (PDF exact; images 1; Word converted to PDF with Cloudmersive, or LibreOffice locally) and returns a signed **upload receipt**. Receipts are tied to the user and valid for 24 hours. If a Word file can't be converted, its count is only an estimate and checkout asks for a PDF instead.
2. **Checkout.** `POST /api/checkout` verifies the receipts, loads the chosen partner (must be approved) and the pricing settings, computes the delivery charge, and prices the order with `quotePrintOrder()`. It creates the order (`pending_payment`), a `Payment` record and the Payment Link, and returns `paymentUrl`. The order page shows the server's breakdown if it differs from the on-screen estimate, then redirects.
3. **Paid.** Three paths can report the payment; whichever comes first settles it and the others become no-ops:
   - the **callback** (customer redirected back): signature checked, link fetched from Razorpay to confirm;
   - the **webhook** `payment_link.paid`: signature checked, duplicates skipped by event id;
   - the **reconcile** job and the status page, which ask Razorpay directly when the webhook is late.
4. **Fulfilment** (`runFulfilment`), each step once, recorded in `Payment.fulfilment`. A 90-second lease (`fulfilment.lockedUntil`) lets only one run proceed, so concurrent callback/webhook/status-page runs can't dispatch twice. If the order turns out to be paid by a different attempt, the remaining steps are skipped and the payment is flagged for a refund. Steps:
   print orders: mark the order paid → create the print job for the chosen shop (docs/PRINT_JOBS.md) → invoice email → admin email. Template purchases: creator earning. A failed step is retried when the customer opens the status page and by the reconcile job, up to 5 times, then the payment is flagged `needsReview`.
5. **Status page** `/payment/status/<ref>` shows paid / waiting / expired / refunded. For templates it continues to document generation with the form data stored at checkout.

## Prices

All amounts are integer **paise**.

| Part | Rule |
|---|---|
| Price (every order is printed by a partner shop) | per file: (colour pages × colour price + B&W pages × B&W price) × 2 for A3 × 1.5 for double-sided × copies, + binding × copies; rounded up to the rupee |
| Mixed colour | pages marked colour are colour; **every other page is B&W** |
| Delivery | `src/lib/delivery/rates.ts` (Shiprocket, or ₹26 per 500 g estimate), same function as `/api/delivery/rate` |
| Processing fee | 3% of the subtotal, shown to the customer |
| Partner share | 90% of the subtotal as a Route transfer, `on_hold` until the partner marks the job printed (only with `RAZORPAY_ROUTE_ENABLED=1`) |
| Template | template price + 3%; creator gets (100 − commission)% of the price |

## Paid templates

Every generator (`generate-fill-pdf` and any other) calls `checkTemplateAccess()`: a paid template needs a paid purchase by the signed-in user (`paymentRef`), allows 5 generations per purchase, and uses the form data stored at checkout. Paid templates are paid for before the document is generated.

## Statuses

`Payment.status`: `created` → `paid` | `expired` | `cancelled`; `paid` → `partially_refunded` | `refunded`. A link paid in the last moment before it expired still settles.

`Order`: `pending_payment` → `paid` (then fulfilment statuses). Unpaid orders stay payable from **My Orders → Complete Payment** (a new link for the stored amount) and are cancelled after 24 hours. When an order is paid, its other open links are cancelled. Cancelling an unpaid order closes its open links first; it is kept as `cancelled` rather than deleted.

Idempotency: each checkout request carries a key; the order is saved with it under a unique index, so a double click or a retry returns the same order and link.

## Refunds

`POST /api/admin/payments/<ref>/refund` `{ reason, amountPaise? }` starts a refund; a full refund also reverses the partner transfer. The order becomes `refunded` when Razorpay confirms with `refund.processed` (or the reconcile job finds it processed). A refunded template sale cancels the creator's pending earning, and a refunded payment never releases a partner transfer.

## Reconcile job

`/api/cron/reconcile-payments` (daily on Vercel Hobby; admins can run it from the dashboard): settles links still open after 10 minutes, retries unfinished fulfilment, recovers old Standard Checkout payments whose webhook was missed, applies refunds the webhook missed, releases held partner transfers for printed orders, and cancels orders unpaid for 24 hours. Phase 3 moves the time-critical parts to QStash.

## Setup

1. Razorpay Dashboard → **Accounts & Settings → API Keys**: generate keys (test mode first).
2. **Webhooks → Add New Webhook**: URL `https://<site>/api/payments/webhook`, a secret you generate, events `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`, `refund.processed`, `refund.failed`, `transfer.processed`, and `payment.captured` (only needed while old Standard Checkout payments may still arrive). Test-mode OTP: `754081`.
3. Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `APP_BASE_URL` (production), `RAZORPAY_ROUTE_ENABLED=1` once Route is active.
4. Vercel preview deployments with Deployment Protection need a protection bypass for the webhook URL, or protection turned off for previews.

The old URL `/api/webhooks/razorpay` still works and runs the same handler.

## When something looks wrong

| Symptom | Where to look |
|---|---|
| Customer paid, order still unpaid | Admin → "Refresh Orders & Check Payments" (runs reconcile), or `POST /api/admin/check-razorpay-order {orderId}` |
| Paid but not printed / no invoice | `Payment.fulfilment` (`lastError`, `attempts`); `/admin/errors` |
| `needsReview` set | amount mismatch, second payment for the same order, refund failed, or fulfilment failing 5 times |
| Webhook failing | Razorpay Dashboard → Webhooks → delivery log; `WebhookEvent` (`status: failed`, `error`) |
