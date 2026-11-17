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

## Auth guards (`src/lib/authz.ts`, `src/lib/cronAuth.ts`)

| Guard | Who passes | Failure |
|---|---|---|
| `requireUser()` | Any signed-in NextAuth session | 401 |
| `requireAdmin()` | Session with `role: admin`, or email in `ADMIN_EMAILS` / `ADMIN_EMAIL` | 401 / 403 |
| `canAccessOrder(user, order)` | Admin, or `order.customerInfo.email` matches the session | caller returns 404 |
| `requirePartnerToken(req)` | `Authorization: Bearer` JWT from `/api/partner/desktop-token`, HS256 with `NEXTAUTH_SECRET`, expiry enforced | 401 |
| `resolvePartnerRequest(req)` | Partner token, or the web session; loads the `Partner` document and requires `isActive` unless `allowInactive` | 401 / 403 / 404 |
| `requireCronSecret(req)` | `Authorization: Bearer $CRON_SECRET` (Vercel Cron) or `x-cron-secret` | 401, also when unset |
| `templateAuth` (`src/lib/templateAuth.ts`) | Session-based template ownership checks | 401 / 403 |

## API routes by domain

"public" means no auth on purpose, or not yet (see the phase column).

### Payments and orders
| Route | Methods | Guard | Notes | Changes in |
|---|---|---|---|---|
| `/api/payment/initiate` | POST | session | Prices the order, creates the Razorpay order and a pending Order | Phase 2: replaced by `/api/checkout` (Payment Links) |
| `/api/payment/verify` | POST | signature | Marks paid, dispatches to the partner, sends the invoice | Phase 2: replaced by the shared `fulfilPaidOrder()` |
| `/api/payment/check-status` | POST | public | Client polling fallback | Phase 2: removed |
| `/api/webhooks/razorpay` | POST | webhook signature | `payment.captured`, `order.paid`, `payment.failed` | Phase 2: `payment_link.*` and `refund.*` |
| `/api/cron/*` | GET/POST | cron secret | Reconcile, cleanup, reminders | Phase 2–3: replaced by QStash jobs |
| `/api/admin/check-pending-payments`, `check-razorpay-order` | POST | admin | Manual reconcile from the dashboard | Phase 2 |
| `/api/orders` | GET | user | Signed-in user's orders (`?email=` admin only) | |
| `/api/orders/[id]` | GET, DELETE | user + owner | | |
| `/api/orders/[id]/track` | GET | public | Shiprocket tracking by order id | Phase 3: owner check |
| `/api/orders/template` | POST | public | Template order creation | Phase 2 |
| `/api/orders/verify/*` | POST | OTP / session | Pickup/delivery handover OTP | |
| `/api/pricing`, `/api/pickup-locations`, `/api/delivery/rate`, `/api/partners/nearby` | GET | public | Read-only data for the order page | |
| `/api/user/orders`, `/api/user/orders/[orderId]` | GET | session | Customer dashboard | |

### Partners
| Route | Methods | Guard | Notes | Changes in |
|---|---|---|---|---|
| `/api/partner/desktop-token` | GET | session | Issues a 30-day device JWT; requires an approved (`isActive`) Partner | Phase 4: one-time code + refresh tokens |
| `/api/partner/orders` | GET | partner | Orders assigned to the partner | Phase 3: Partner API v1 (jobs, claim) |
| `/api/partner/orders/[orderId]` | PATCH | partner | Forward-only status moves (`src/lib/partnerOrderTransitions.ts`), conditional update | Phase 3: order state machine |
| `/api/partner/profile` | GET, POST | partner (inactive allowed) | Apply / edit shop. New partners start `isActive: false`; partners can't set `isActive`, and can't change `razorpayAccountId` after approval | Phase 4 |
| `/api/partner/financials` | GET | partner | | |
| `/api/admin/partners` | GET | admin | | Phase 4 |
| `/api/admin/partners/[id]` | PATCH | admin | Approve/deactivate (`isActive`), set the Route linked account | Phase 4 |

### Admin (all `requireAdmin` except where noted)
`/api/admin/orders`, `orders/[id]`, `orders/[id]/ship`, `pricing`, `pickup-locations`, `info` (GET public: home page reads it), `save-template` (GET public: template fill pages read it), `pdf-viewer` (`requireUser` + owner), `upload-pdf`, `templates/**`, `creator-earnings`, `creator-earnings/process` (RazorpayX payouts), `send-payment-reminder`, `cleanup-pending-orders`, `migrate-*`, `printer-status`, `printer-queue/*`.
Phase 3 removes `printer-status`, `printer-queue/*`, `/api/printer`, `/api/printer/process-pending` and `/api/printing/jobs/[id]/status` (the old central Printer-API path).

### Auth and users
`/api/auth/[...nextauth]` (NextAuth), `register`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password`, `setup-password`, `send-otp` / `verify-otp` (rate-limited by email and IP), `check-admin` (session only). `/api/user/*` all use the session.

### Templates marketplace
`/api/templates` (list), `create`, `public`, `my-templates`, `[id]`, `[id]/update-file`, `[id]/earnings`, `pay` + `pay/verify` (Phase 2 moves to Payment Links), `generate*`, `generation-status/[jobId]`, `preview*`, `download-filled`, `user-download`, `/api/save-template`. Several generation and preview routes are public; Phase 7 reviews them together with the document tools.

### Document tools (Phase 7 consolidates these; all public today)
`convert-docx-to-html`, `convert-word-to-pdf`, `convert-pdf-to-word`, `edit-docx-template`, `extract-placeholders`, `extract-placeholders-range`, `extract-word-info`, `generate-document`, `generate-dynamic-form`, `generate-personalized-document`, `parse-docx-structure`, `replace-placeholders`, `document-proxy` (SSRF risk), `pdf/fetch`, `wopi/files/[id]`. Uploads: `upload-file`, `upload-raw-file`, `upload/verify`, `pdf/upload` (all `requireUser`).

## Library modules (`src/lib`)

| Area | Modules | Notes |
|---|---|---|
| Platform | `env`, `logger`, `mongodb`, `ratelimit`, `jobStore` (Upstash Redis) | |
| Auth | `auth` (NextAuth config), `authz`, `cronAuth`, `templateAuth`, `otp-store`, `password-reset-store`, `email-verification` | `otp-store` is in-memory: Phase 4 moves it to Redis |
| Payments | `razorpay`, `razorpayFallback`, `paymentUtils` (client), `razorpayPayouts`, `pricing`, `orderUtils`, `orderStatePersistence` | Phase 2 replaces with `services/payments` and `services/pricing` |
| Fulfilment | `printerClient`, `wssClient`, `partnerOrderTransitions`, `shiprocket`, `cartUtils` | `printerClient`'s Printer-API path goes in Phase 3 |
| Email | `mailer` (one transport), `notificationService`, `invoiceEmail`, `invoiceGenerator`, `dispatch-email`, `adminNotifications` | |
| Documents | `docxProcessor`, `cloudmersive`, `libreoffice`, `freeConverters`, `renderPdfService`, `pdfGenerator`, `fileTypeDetection` | Phase 7: one converter interface |
| Storage | `storage` (provider switch), `storage/cloudinary`, `storage/oracle`, `cloudinary` | Phase 7: merge the two Cloudinary modules |
| Misc | `seo`, `phoneValidation`, `adminUtils` | |

## Models (`src/models`)

`Order` (the only order model; indexes on Razorpay ids, customer email, partner + status, payment status), `PrintJob`, `Partner`, `User`, `Pricing`, `PickupLocation`, `AdminInfo`, `DynamicTemplate`, `CreatorEarning`, `VerificationToken`.

Order state today is spread over `status`, `orderStatus` and `paymentStatus`. Phase 3 replaces this with one status field plus a separate payment status, and adds an `OrderEvent` log.

## Pages (`src/app`)

Customer: `/`, `/order`, `/cart`, `/my-orders`, `/orders/[id]`, `/verify-order/[id]`, `/templates/**`, `/my-templates`, `/profile`, `/dashboard`, `/payout-settings`, `/complete-profile`, `/auth/*`.
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
