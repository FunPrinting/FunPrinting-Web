# Error tracking

Errors and warnings that happen to users are stored in MongoDB and reviewed at **`/admin/errors`**. Repeats of the same bug are grouped into one issue with a count, so the list shows what is broken and how often, not every log line.

No third-party service is involved. If the app later outgrows this (alerting, performance tracing, session replay), Sentry is the usual next step; the capture points below are the same ones Sentry would hook.

## What is captured

| Source | How | Code |
|---|---|---|
| Server, uncaught | Uncaught errors in route handlers, server components and server actions, via Next's `onRequestError` | `src/instrumentation.ts` |
| Server, handled | Every server `console.error` (error) and `console.warn` (warning), and `logger.error` / `logger.warn`. Printed output is unchanged | `src/lib/errorTracking/consoleHook.ts`, `src/lib/logger.ts` |
| Browser | Uncaught errors, unhandled promise rejections, and crashes caught by `error.tsx` / `global-error.tsx` (users see a "Something went wrong" page with a reference code) | `src/components/ErrorReporter.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx` |
| WSS server | `console.error` / `console.warn`, unhandled rejections, uncaught exceptions (reported, then the process exits and Render restarts it) | `funprinting-wss/src/errorReporter.js` |
| Partner apps | `POST /api/errors` with `source: "desktop"` or `"mobile"` and the device token (Phases 5 and 6) | see "Reporting from the partner apps" |

Explicit capture from server code, when there is no log line to hook:

```ts
import { captureException } from '@/lib/errorTracking/server';
await captureException(error, { route: '/api/checkout', context: { orderId } });
```

From client code:

```ts
import { reportThrown } from '@/lib/errorTracking/client';
reportThrown(error, { context: { step: 'upload' } });
```

## Data model (`ErrorGroup`)

One document per issue, keyed by `fingerprint`:
- `source` (server, client, wss, desktop, mobile), `level` (error, warning), `name`, `message`, `route`
- `count`, `firstSeenAt`, `lastSeenAt`, `firstRelease`, `lastRelease` (git commit)
- `status`: `open`, `resolved` or `ignored`; `resolvedBy`, `resolvedAt`, `note`
- `regressedAt`: set when a resolved issue happens again (it reopens automatically). Ignored issues stay ignored.
- `samples`: the 5 most recent occurrences, each with stack, URL, method, request id, user id, partner id, release, user agent, digest and context.

**Grouping.** The fingerprint combines source, error name, the message with ids and numbers replaced (`Order ORD123 failed` and `Order ORD456 failed` group together), and the first stack frame from app code without line numbers (so a redeploy doesn't split an issue). Without a stack, the route is used instead.

**Retention.** Issues not seen for 90 days are deleted by a TTL index.

## Privacy

Before anything is stored:
- emails, phone numbers, JWTs, `Bearer` tokens, Razorpay keys, MongoDB URIs and `password=` / `token=` / `otp=` values are replaced with placeholders;
- URLs lose their query string and hash (payment callbacks carry signatures there);
- context keys that look sensitive (`email`, `phone`, `address`, `customerInfo`, `token`, `cookie`, …) are redacted;
- messages, stacks and context values are length-limited.

Only user and partner **ids** are stored, never names or contact details.

## Limits

Capture is best-effort and can never break a request:
- it never throws; DB calls time out after 3 s;
- capture's own failures are printed but not re-captured;
- each issue is written at most once per 10 s per server instance (repeats in between are added to the next write's count), and an instance writes at most 120 records per minute;
- `POST /api/errors` accepts 64 KB per report and 30 reports per minute per IP; browsers send at most 10 reports per page view and drop duplicates;
- on Vercel, writes run in Next's `after()`, so they finish even after the response is sent.

Set `ERROR_TRACKING_DISABLED=1` to turn capture off.

## Reviewing

1. Open `/admin/errors` (admin only). The Open tab lists issues by last seen; filter by source, level or text.
2. Click an issue for its recent events and stack traces. The request id matches the `requestId` in the JSON logs, which gives the full log trail on Vercel or Render.
3. After fixing, **Mark resolved**. If it happens again it reopens with a "regressed" badge. Use **Ignore** for known noise (e.g. a third-party outage you can't fix).

## Reporting from the partner apps

`POST https://www.funprinting.store/api/errors`

```http
Authorization: Bearer <partner device token>
Content-Type: application/json

{
  "source": "desktop",          // or "mobile"
  "level": "error",             // or "warning"
  "name": "PrinterError",
  "message": "Paper out on HP LaserJet",
  "stack": "...",
  "appVersion": "1.4.2",
  "platform": "win32",
  "context": { "orderId": "ORD123", "printer": "HP LaserJet" }
}
```

Without a valid token the report is stored as `client`. The response is always `202`, so a reporter should not retry. Apps should apply the same limits as the browser: drop duplicates and cap reports per session.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `MONGODB_URI` | web | Storage (capture is skipped if unset) |
| `ERROR_TRACKING_DISABLED` | web | `1` turns capture off |
| `WSS_DISPATCH_SECRET` | web, WSS | Verifies WSS error reports |
| `WEB_API_URL` | WSS | Where the WSS sends reports; unset = log only |
| `VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `APP_RELEASE` | web, WSS | Release tag on each event (set automatically by Vercel and Render) |
