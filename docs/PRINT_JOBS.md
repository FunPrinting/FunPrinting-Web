# Print jobs

Every paid print order becomes one **print job** (`PrintJob`, collection `print_jobs`) owned by the shop the customer chose. The platform's own shop is an ordinary partner. **Jobs are never moved to another shop.**

Code: `src/lib/jobs/`. Partner API: `/api/partner/v1/jobs`.

## Lifecycle

```
paid ─► pending_acceptance ─accept─► queued ─claim─► claimed ─► printing ─► printed
        (manual shops)               (auto shops start here)
             │                          │
             └──── decline / customer refund / 24 h / admin cancel ────► cancelled
```

| Status | Meaning |
|---|---|
| `pending_acceptance` | Manual-mode shop must accept it |
| `queued` | In the shop's queue, waiting for a device |
| `claimed` | A device has taken it (5-minute lease) |
| `printing` | The device reported that printing started |
| `printed` | Done; order becomes `printed`, the shop's held payout is released |
| `failed` | Printing failed; back in the queue (flagged after 3 failures) |
| `cancelled` | Declined, refunded, or cancelled by an admin |

The order's status follows the job forward (`paid` → `processing` → `printing` → `printed`). If a shop updates the order from its order list instead (web dashboard, mobile app, current desktop app), the job follows the order.

## Shop settings

Partners choose on their dashboard (`/api/partner/profile` `acceptanceMode`):
- **Automatic** (default): paid orders go straight to the print queue.
- **Manual**: each order must be accepted first.

## When the shop doesn't take the order

| When | What happens |
|---|---|
| 10 minutes after payment, not accepted or claimed | The customer is emailed (once) and sees a banner in My Orders: **Keep waiting** or **Refund now** (`/orders/<id>/choose`). The order stays with the shop, which can still accept. |
| The shop declines | Refunded straight away |
| 24 hours after payment, still not accepted or claimed | Refunded automatically |
| Shop deactivated after checkout | Refunded straight away |

Once a shop accepts or a device claims the job, no deadline applies. After printing has started, only an admin can cancel (with `force`).

Deadlines run in three ways, so a missed one is always picked up:
1. **QStash** delayed messages to `/api/jobs/deadline` at the exact time (needs `QSTASH_TOKEN`, signing keys and `APP_BASE_URL`);
2. a sweep each time a partner device lists its jobs;
3. the daily reconcile cron.

## Partner API (devices)

Auth: the partner device token (`Authorization: Bearer`), plus `x-device-id` (a stable id the app generates once, 8–64 characters `[A-Za-z0-9_.:-]`).

| Call | Purpose |
|---|---|
| `GET /api/partner/v1/jobs?scope=active\|history` | The shop's jobs, with files and options |
| `POST /api/partner/v1/jobs/claim` | Take the oldest queued job (or `{ job: null }`) |
| `POST /api/partner/v1/jobs/<jobId>` `{ action: 'accept' }` | Manual shops accept |
| `… { action: 'reject', reason? }` | Decline (customer is refunded) |
| `… { action: 'claim' }` | Take a specific job |
| `… { action: 'report', status: 'printing' }` | Started / still printing (renews the 5-minute lease) |
| `… { action: 'report', status: 'printed' }` | Done |
| `… { action: 'report', status: 'failed', error }` | Failed; back in the queue |
| `… { action: 'report', status: 'release' }` | Give it back without printing |

Devices fetch the job list on start-up, on every socket reconnect, and when the socket server sends `jobs:available`. The socket carries no job data, so a device that was offline misses nothing. Two devices can't print the same job: a claim is atomic, and a device that stops reporting loses its lease after 5 minutes.

The desktop app (partner-desktop, from Phase 5) works this way: it takes **one job at a time** (claim, print every file, report `printed` or `failed`), sends `printing` every 2 minutes as a heartbeat, and also re-fetches every minute. Several computers can share a shop's queue. Manual-mode shops accept or decline in the app as well as on the dashboard.

The mobile app (partner-mobile, from Phase 6) is a companion by default: it lists jobs and lets manual-mode shops accept or decline. In **print station** mode it works like the desktop app, but claims a specific job by id (`{ action: 'claim' }`) and only one it can print (PDF/images, and options its printer supports), leaving the rest for a computer.

**Compatibility with apps on a legacy token** (installed before device sign-in). These rules apply only when the request or socket has no device id:
- Automatic-mode shops also receive the old `new_print_job` push. Only legacy sockets get it and are counted; a device receiving it counts as a claim (`legacy-push`).
- When a legacy desktop app fetches `GET /api/partner/orders`, the shop's queued jobs are claimed (`legacy-pull`), because that app prints every paid order it sees.
- Orders waiting for a manual shop to accept are hidden from legacy apps; the shop accepts or declines on the web dashboard.
- Claims by legacy apps never report "printed"; if the order isn't moved to printed within 24 hours, the job is flagged for an admin (it shows in `/admin/errors`).

## Orders from before print jobs

Orders paid before this system have no job and are left alone. If an admin uses **Send to shop**, a job is created **without deadlines or automatic refunds**; if the order is already processing or printed, the job just records that (re-printing needs **Print again**, i.e. `force`).

## Safety rules

- A refund is never issued once the shop has accepted, a device has claimed, or the order has moved to processing or later. The check is part of the cancel update, so a shop accepting at the same moment wins.
- System refunds are saved on the payment before Razorpay is called and retried by the reconcile job if Razorpay fails.
- A payment refunded by any route cancels its job (unless already printed).
- A job that a device is printing is never handed to another device, even after its lease runs out; it is flagged instead.

## Admin

`POST /api/admin/orders/<id>/job` (also on the admin order page, "Print job" panel):
- `{ action: 'resend', force? }`: put a waiting or failed job back in its shop's queue; `force` re-queues a job that was taken or printed (prints again).
- `{ action: 'cancel', reason, refund = true, force = false }`.

`GET /api/admin/orders/<id>/job` returns the job with its full history.

## Environment

| Variable | Purpose |
|---|---|
| `QSTASH_TOKEN` | Publish deadline messages (optional; sweeps cover it) |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Verify `/api/jobs/deadline` calls |
| `APP_BASE_URL` | Public URL QStash calls back to |
| `WSS_API_URL`, `WSS_DISPATCH_SECRET` | `jobs:available` notifications |
