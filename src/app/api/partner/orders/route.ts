import { NextRequest, NextResponse, after } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import Order from '@/models/Order';
import { forPartner } from '@/lib/partnerOrderView';
import PrintJob, { type IPrintJob } from '@/models/PrintJob';
import { event, syncOrderFromJob } from '@/lib/jobs/service';

/** At most one deadline sweep per instance per minute from this busy endpoint. */
let lastSweep = 0;

/**
 * GET /api/partner/orders?status=...
 *
 * The shop's orders, with each order's print job (status, deadlines) for the web
 * dashboard's Accept / Decline buttons.
 *
 * Compatibility with apps on a legacy token, which don't know about print jobs:
 * - Orders waiting for a manual-mode shop to accept are not sent to the apps, so they
 *   can't print or advance an order the shop hasn't accepted.
 * - The desktop app prints every paid order it receives here, so its fetch claims
 *   the shop's queued jobs ("legacy-pull"): they then count as taken and are not
 *   offered for refund while the app prints them. Phase 5 replaces this with
 *   /api/partner/v1/jobs.
 */
export async function GET(request: NextRequest) {
  const log = withRequestLogger(request);
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const partnerId = resolved.partner._id.toString();
    // Only apps on a legacy token need the compatibility behaviour; apps with device
    // sign-in (resolved.deviceId) use /api/partner/v1/jobs and know about acceptance.
    const fromLegacyApp = Boolean(request.headers.get('authorization')) && !resolved.deviceId;
    const fromDesktopApp = fromLegacyApp && /Electron/i.test(request.headers.get('user-agent') || '');

    const status = request.nextUrl.searchParams.get('status') || 'all';
    const query: Record<string, unknown> = { $or: [{ partnerId }, { 'deliveryOption.partnerId': partnerId }] };
    if (status !== 'all') query.status = status;

    if (fromDesktopApp) {
      const now = new Date();
      const queued = await PrintJob.find({ partnerId, status: 'queued' }).select('_id orderId').lean<Array<Pick<IPrintJob, '_id' | 'orderId'>>>();
      for (const j of queued) {
        const claimed = await PrintJob.findOneAndUpdate(
          { _id: j._id, status: 'queued' },
          {
            $set: { status: 'claimed', firstClaimedAt: now, claim: { deviceId: 'legacy-pull', leaseUntil: new Date(now.getTime() + 24 * 3600_000) } },
            $unset: { acceptBy: '', refundBy: '' },
            $inc: { version: 1 },
            $push: { history: event('claimed', 'device:legacy-pull', 'installed desktop app fetched its orders') },
          }
        );
        if (claimed) await syncOrderFromJob(j.orderId, 'claimed', { shopDelayNotifiedAt: null });
      }
    }

    const orders = await Order.find(query).sort({ createdAt: -1 }).lean<Array<Record<string, any>>>();
    const jobs = await PrintJob.find({ orderId: { $in: orders.map((o) => o.orderId) } })
      .select('jobId orderId status acceptBy refundBy acceptanceMode printedBy claim.printer')
      .lean<Array<Pick<IPrintJob, 'jobId' | 'orderId' | 'status' | 'acceptBy' | 'refundBy' | 'acceptanceMode' | 'printedBy' | 'claim'>>>();
    const jobByOrder = new Map(jobs.map((j) => [j.orderId, j]));

    const visible = fromLegacyApp ? orders.filter((o) => jobByOrder.get(o.orderId)?.status !== 'pending_acceptance') : orders;
    const result = visible.map((o) => {
      const j = jobByOrder.get(o.orderId);
      const view = forPartner(o);
      return j ? { ...view, job: { jobId: j.jobId, status: j.status, acceptBy: j.acceptBy, refundBy: j.refundBy, acceptanceMode: j.acceptanceMode, printedBy: j.printedBy, printer: j.claim?.printer } } : view;
    });

    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      after(async () => {
        const { sweepDeadlines } = await import('@/lib/jobs/deadlines');
        await sweepDeadlines(20).catch((err) => log.warn({ err }, 'deadline sweep failed'));
      });
    }

    return NextResponse.json({ success: true, count: result.length, orders: result });
  } catch (error) {
    log.error({ err: error }, 'failed to fetch partner orders');
    return NextResponse.json({ success: false, error: 'Failed to fetch partner orders' }, { status: 500 });
  }
}
