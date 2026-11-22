import { NextRequest, NextResponse, after } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import Order from '@/models/Order';
import { forPartner } from '@/lib/partnerOrderView';
import PrintJob, { type IPrintJob } from '@/models/PrintJob';

/** At most one deadline sweep per instance per minute from this busy endpoint. */
let lastSweep = 0;

/**
 * GET /api/partner/orders?status=...
 *
 * The shop's orders, with each order's print job (status, deadlines) for the web
 * dashboard's Accept / Decline buttons.
 */
export async function GET(request: NextRequest) {
  const log = withRequestLogger(request);
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const partnerId = resolved.partner._id.toString();
    const status = request.nextUrl.searchParams.get('status') || 'all';
    const query: Record<string, unknown> = { $or: [{ partnerId }, { 'deliveryOption.partnerId': partnerId }] };
    if (status !== 'all') query.status = status;

    const orders = await Order.find(query).sort({ createdAt: -1 }).lean<Array<Record<string, any>>>();
    const jobs = await PrintJob.find({ orderId: { $in: orders.map((o) => o.orderId) } })
      .select('jobId orderId status acceptBy refundBy acceptanceMode printedBy claim.printer')
      .lean<Array<Pick<IPrintJob, 'jobId' | 'orderId' | 'status' | 'acceptBy' | 'refundBy' | 'acceptanceMode' | 'printedBy' | 'claim'>>>();
    const jobByOrder = new Map(jobs.map((j) => [j.orderId, j]));

    const result = orders.map((o) => {
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
