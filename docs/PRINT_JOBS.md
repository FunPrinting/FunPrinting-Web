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

**Compatibility:** until the desktop app pulls jobs (Phase 5), automatic-mode shops also receive the old `new_print_job` push. A device receiving it counts as a claim, so the job won't be refunded while that app prints it.

## Admin

`POST /api/admin/orders/<id>/job`:
- `{ action: 'resend' }`: put the job back in its shop's queue; creates a job for orders paid before this system existed (no automatic refund for those).
- `{ action: 'cancel', reason, refund = true, force = false }`.

`GET /api/admin/orders/<id>/job` returns the job with its full history.

## Environment

| Variable | Purpose |
|---|---|
| `QSTASH_TOKEN` | Publish deadline messages (optional; sweeps cover it) |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Verify `/api/jobs/deadline` calls |
| `APP_BASE_URL` | Public URL QStash calls back to |
| `WSS_API_URL`, `WSS_DISPATCH_SECRET` | `jobs:available` notifications |
