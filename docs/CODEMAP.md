# Code map

Where things live, how requests are protected, and which rebuild phase changes each area. Update this file in the same PR as any route, model or service change.

Related repos: `funprinting-wss` (Socket.IO notifier), `partner-desktop` (Electron print client), `partner-mobile` (Expo companion app).

## Request path

```
browser / partner app
  → src/app/**/route.ts     validate input, check auth (src/lib/authz.ts), call lib code
  → src/lib/*                business logic, external APIs (Razorpay, Shiprocket, mail, storage)
  → src/models/*             mongoose models
  → src/lib/wssClient.ts     signed HTTP call → funprinting-wss → partner device room
```

Rules for new code:
- Server-only modules start with `import 'server-only'` so they can't be bundled into client components.
- Read config through `getServerEnv()` (`src/lib/env.ts`). It lists every missing variable in one error.
- Log with `withRequestLogger(req)` (`src/lib/logger.ts`). Log ids, never whole orders, request bodies, emails or phone numbers.
- Every handler checks auth first, using one of the guards below.
- Errors and warnings are stored automatically (console, logger, uncaught, browser). See `docs/ERROR_TRACKING.md`; review them at `/admin/errors`.

## Auth guards (`src/lib/authz.ts`, `src/lib/cronAuth.ts`)

| Guard | Who passes | Failure |
|---|---|---|
| `requireUser()` | Any signed-in NextAuth session | 401 |
| `requireAdmin()` | Session with `role: admin`, or email in `ADMIN_EMAILS` / `ADMIN_EMAIL` | 401 / 403 |
| `canAccessOrder(user, order)` | Admin, or `order.customerInfo.email` matches the session | caller returns 404 |
| `requirePartnerToken(req)` | `Authorization: Bearer`: device access token (`PARTNER_JWT_SECRET`, 15 min, has `did`) or legacy app token (`NEXTAUTH_SECRET`) | 401 |
| `resolvePartnerRequest(req)` | Partner token (device must not be signed out), or the web session; loads the `Partner` and requires `isActive` unless `allowInactive` | 401 / 403 / 404 |
| `requireCronSecret(req)` | `Authorization: Bearer $CRON_SECRET` (Vercel Cron) or `x-cron-secret` | 401, also when unset |
| `templateAuth` (`src/lib/templateAuth.ts`) | Session-based template ownership checks | 401 / 403 |

## API routes by domain

"public" means no auth on purpose, or not yet (see the phase column).

### Payments and orders
| Route | Methods | Guard | Notes | Changes in |
|---|---|---|---|---|
| `/api/upload-file` | POST | user | Stores the file, counts pages on the server, returns a signed upload receipt | |
| `/api/checkout` | POST | user | Prices the order from receipts + server data; creates Order, Payment and a Razorpay Payment Link | |
| `/api/checkout/template` | POST | user | Paid template purchase (price from the template) | |
| `/api/orders/[id]/pay` | POST | user + owner | Pay an unpaid order: reuses the open link or creates a new attempt | |
| `/api/payments/callback` | GET | Razorpay signature | Customer returns from Razorpay; settles and redirects to `/payment/status/<ref>` | |
| `/api/payments/webhook` (+ legacy `/api/webhooks/razorpay`) | POST | webhook signature | `payment_link.*`, `refund.*`, `transfer.processed`, legacy `payment.captured` | |
| `/api/payments/[ref]` | GET | owner / admin | Status for the status page; asks Razorpay if the webhook is late | |
| `/api/cron/reconcile-payments` | GET | cron secret | Settles missed links, retries fulfilment, cancels 24 h unpaid orders | Phase 3: QStash |
| `/api/admin/check-pending-payments`, `check-razorpay-order` | POST | admin | Run reconcile / re-check one payment | |
| `/api/admin/payments/[ref]/refund` | POST | admin | Start a refund | Phase 3: automatic refunds on timeout |
| `/api/cron/cleanup-files`, `send-payment-reminders` | GET | cron secret | | |
| `/api/orders` | GET | user | Signed-in user's orders (`?email=` admin only) | |
| `/api/orders/[id]` | GET, DELETE | user + owner | | |
| `/api/orders/[id]/track` | GET | public | Shiprocket tracking by order id | Phase 3: owner check |
| `/api/orders/verify/*` | POST | OTP / session | Pickup/delivery handover OTP | |
| `/api/pricing`, `/api/pickup-locations`, `/api/partners/nearby` | GET | public | Read-only data for the order page (nearby shops: public fields only) | |
| `/api/delivery/options` | GET | public, rate-limited | Pickup / shop delivery / courier options for one shop and address (docs/DELIVERY.md) | |
| `/api/partner/orders/[orderId]/ship` | POST | partner | Shop books the courier pickup after printing | |
| `/api/webhooks/courier-updates` | POST | `x-api-key` = `SHIPROCKET_WEBHOOK_TOKEN` | Shiprocket tracking; marks courier orders delivered | |

### Print jobs (docs/PRINT_JOBS.md)
| Route | Methods | Guard | Notes |
|---|---|---|---|
| `/api/partner/v1/jobs` | GET | partner + `x-device-id` | The shop's jobs (devices pull) |
| `/api/partner/v1/jobs/claim` | POST | partner device | Take the oldest queued job |
| `/api/partner/v1/jobs/[jobId]` | POST | partner (device for claim/report) | accept, reject, claim, report printing/printed/failed/release |
| `/api/jobs/deadline` | POST | QStash signature | Accept deadline (notify customer) / 24 h refund |
| `/api/orders/[id]/choose` | GET, POST | email token or order owner | Shop late: refund now or keep waiting |
| `/api/admin/orders/[id]/job` | GET, POST | admin | Job + history; resend, cancel (refund) |

### Partners
| Route | Methods | Guard | Notes | Changes in |
|---|---|---|---|---|
| `/api/partner/device-auth/code` | POST | session (approved partner) | One-time sign-in code for an app (PKCE), see docs/PARTNER_AUTH.md | |
| `/api/partner/device-auth/token` | POST | code + verifier, or refresh token | 15-min access token + rotating 30-day refresh token | |
| `/api/partner/devices` | GET, DELETE | partner | Signed-in apps; sign one out | |
| `/api/partner/desktop-token` | GET | session | Legacy 30-day token for apps installed before device sign-in | Remove after Phases 5–6 |
| `/api/partner/orders` | GET | partner | Orders assigned to the partner | Phase 3: Partner API v1 (jobs, claim) |
| `/api/partner/orders/[orderId]` | GET, PATCH | partner | GET: one order (desktop summary sheet). PATCH: forward-only status moves (`src/lib/partnerOrderTransitions.ts`), conditional update | Phase 3: order state machine |
| `/api/partner/profile` | GET, POST | partner (inactive allowed) | Apply / edit shop. New partners start `isActive: false`; partners can't set `isActive`, and can't change `razorpayAccountId` after approval | Phase 4 |
| `/api/partner/financials` | GET | partner | | |
| `/api/admin/partners` | GET | admin | | Phase 4 |
| `/api/admin/partners/[id]` | PATCH | admin | Approve/deactivate (`isActive`), set the Route linked account | Phase 4 |

### Admin (all `requireAdmin` except where noted)
`/api/admin/orders`, `orders/[id]`, `orders/[id]/ship`, `pricing`, `pickup-locations`, `info` (GET public: home page reads it), `save-template` (POST admin; GET public for the fill page, Word file URL for admins only), `pdf-viewer` (`requireUser` + owner), `upload-pdf`, `templates/**`, `creator-earnings`, `creator-earnings/process` (RazorpayX payouts), `send-payment-reminder`, `cleanup-pending-orders`, `migrate-*`, `printer-status`, `printer-queue/*`.
The central Printer-API path (`printer-status`, `printer-queue/*`, `/api/printer*`, `/api/printing/*`, `printerClient`, the printer monitor page) was removed in Phase 3: every order is printed by a partner shop.

### Error tracking
| Route | Methods | Guard | Notes |
|---|---|---|---|
| `/api/errors` | POST | public, rate-limited; partner token or WSS signature sets the source | Browser, WSS and partner app reports |
| `/api/admin/errors` | GET | admin | List issues with filters and status counts |
| `/api/admin/errors/[id]` | GET, PATCH | admin | Detail with samples; resolve / ignore / reopen, note |

### Auth and users
`/api/auth/[...nextauth]` (NextAuth), `register`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password`, `setup-password`, `send-otp` / `verify-otp` (rate-limited by email and IP), `check-admin` (session only). `/api/user/*` all use the session.

### Templates marketplace
`/api/templates` (list for the browse page: cards only, no Word files or schemas), `create`, `my-templates`, `[id]` (Word file for owner/admin), `[id]/update-file`, `[id]/earnings`, `generate-fill-pdf` (sign-in; PDF in the background with `after()`), `generation-status/[jobId]` (owner only), `download-filled` (sign-in). See `docs/DOCUMENTS.md`.

### Document tools
`extract-placeholders` (sign-in), `parse-docx-structure` (page count preview, rate-limited). Uploads: `upload-file`, `upload-raw-file` (Word/PDF, 20 MB) (both `requireUser`). The order page counts PDF pages in the browser for the preview; the upload recounts. Conversion and file downloads go through `src/lib/documents/` (`docs/DOCUMENTS.md`).

## Library modules (`src/lib`)

| Area | Modules | Notes |
|---|---|---|
| Platform | `env`, `logger`, `mongodb`, `ratelimit`, `jobStore` (Upstash Redis) | |
| Error tracking | `errorTracking/server` (capture, grouping, throttling), `errorTracking/scrub` (privacy, fingerprint), `errorTracking/consoleHook`, `errorTracking/client` | Installed from `src/instrumentation.ts`; browser side via `components/ErrorReporter` |
| Auth | `auth` (NextAuth config), `authz`, `cronAuth`, `templateAuth`, `otp-store`, `password-reset-store`, `email-verification` | `otp-store` is in-memory: Phase 4 moves it to Redis |
| Payments | `payments/quote` (the only price calculation), `payments/money` (paise, fee), `payments/checkout`, `payments/templateCheckout`, `payments/links`, `payments/fulfil` (settle + idempotent side effects), `payments/webhooks`, `payments/reconcile`, `payments/refunds` (refunds, Route transfer release), `payments/signatures`, `payments/razorpayApi`, `payments/client` (browser) | See `docs/PAYMENTS.md` |
| Order page | `src/app/order/page.tsx` (state and payment), `src/components/order/*` (FileCard, FileDropzone, ShopPicker, DeliveryChooser, Segmented), `src/lib/order/files.ts` (pure model and price estimate, tested), `src/lib/order/client.ts` (page counts, uploads with progress), `src/lib/orderStatePersistence.ts` (draft across Google sign-in) | |
| Uploads and delivery | `uploads/pageCount`, `uploads/receipt`, `delivery/rates` (courier quotes), `delivery/options` (what a shop offers, pickup registration, handover code), `delivery/courier` (booking), `partnerOrderView` (hides the handover code from shops) | |
| Pricing settings and payouts | `pricing` (Pricing model access), `razorpayPayouts` (creator payouts via RazorpayX), `orderUtils`, `orderStatePersistence` | |
| Fulfilment | `jobs/service` (create, accept, claim, report, sync), `jobs/deadlines` (customer notice, 24 h refund, cancel), `jobs/assign`, `jobs/scheduler` (QStash), `jobs/emails`, `jobs/deliveryNumber`, `wssClient`, `partnerOrderTransitions`, `shiprocket`, `cartUtils` | |
| Email | `mailer` (one transport), `notificationService`, `invoiceEmail`, `invoiceGenerator`, `dispatch-email`, `adminNotifications` | |
| Documents | `documents/convert` (one converter interface), `documents/fileUrls` (the only way to download stored files), `documents/templates`, `docxProcessor`; providers `cloudmersive`, `freeConverters`, `libreoffice`, `renderPdfService`; `fileTypeDetection` | |
| Storage | `storage` (provider switch), `storage/cloudinary`, `storage/oracle`, `cloudinary` | Phase 7: merge the two Cloudinary modules |
| Misc | `seo`, `phoneValidation`, `adminUtils` | |

## Models (`src/models`)

`PartnerDevice` (signed-in partner apps), `DeviceAuthCode` (one-time sign-in codes), `PrintJob` (one per paid order; collection `print_jobs`), `Payment` (one per payment attempt; amounts in paise, fulfilment steps, events), `WebhookEvent` (processed Razorpay events, 30-day TTL), `ErrorGroup` (error tracking issues, 90-day TTL), `Order` (the only order model; indexes on Razorpay ids, customer email, partner + status, payment status), `PrintJob`, `Partner`, `User`, `Pricing`, `PickupLocation`, `AdminInfo`, `DynamicTemplate`, `CreatorEarning`, `VerificationToken`.

Order state today is spread over `status`, `orderStatus` and `paymentStatus`. Phase 3 replaces this with one status field plus a separate payment status, and adds an `OrderEvent` log.

## Pages (`src/app`)

Customer: `/`, `/order`, `/payment/status/[ref]`, `/orders/[id]/choose`, `/cart`, `/my-orders`, `/orders/[id]`, `/verify-order/[id]`, `/templates/**`, `/my-templates`, `/profile`, `/dashboard`, `/payout-settings`, `/complete-profile`, `/auth/*`.
Partner: `/partner`, `/partner/dashboard`, `/partner/desktop-auth` (callback allowlist: `localhost:4321`, `funprintingpartner://`).
Admin: `/admin/**`, gated by `AdminGoogleAuth` (session + `/api/auth/check-admin`); the API routes enforce it again server-side.
Static: policies, contact, `sitemap.xml`.

## Checks

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint flat config (`eslint.config.mjs`) |
| `npm test` | Vitest (`src/**/*.test.ts`, `test/**/*.test.ts`) |
| `npm run build` | `next build`; type and lint errors fail it |

CI (`.github/workflows/ci.yml`) runs all four on every push to `main` and every pull request.
