import { NextRequest, NextResponse, after } from 'next/server';
import { getSessionUser, isAdminSession } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment } from '@/models/Payment';
import { syncPaymentFromRazorpay } from '@/lib/payments/reconcile';
import { runFulfilment } from '@/lib/payments/fulfil';

export const runtime = 'nodejs';

/** Minimum gap between Razorpay lookups for one payment from the status page. */
const SYNC_INTERVAL_MS = 15_000;
const lastSync = new Map<string, number>();

/**
 * GET /api/payments/[ref] — payment status for its owner (or an admin).
 *
 * While a link is unpaid, this also asks Razorpay (at most every 15 s), so the
 * status page updates even if the webhook is delayed.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  const { ref } = await params;
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(ref)) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  const log = withRequestLogger(request, { referenceId: ref });

  await connectDB();
  let p = await Payment.findOne({ referenceId: ref }).lean<IPayment | null>();
  const admin = isAdminSession(user);
  if (!p || (!admin && p.userEmail !== user.email)) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const now = Date.now();
  const age = now - new Date(p.createdAt).getTime();

  // If there are refunds that haven't been confirmed yet, check their status with Razorpay
  const unprocessedRefunds = (p?.razorpay?.refundIds ?? []).filter((id) => !(p?.razorpay?.processedRefundIds ?? []).includes(id));
  if (p && unprocessedRefunds.length > 0) {
    try {
      const { fetchRefund } = await import('@/lib/payments/razorpayApi');
      const { applyRefundProcessed } = await import('@/lib/payments/refunds');
      for (const refundId of unprocessedRefunds) {
        const refund = await fetchRefund(refundId);
        if (refund.status === 'processed') {
          await applyRefundProcessed({ id: refund.id, payment_id: p.razorpay.paymentId!, amount: refund.amount });
        }
      }
      p = (await Payment.findOne({ referenceId: ref }).lean<IPayment | null>()) ?? p;
    } catch (error) {
      log.warn({ err: error }, 'failed to sync refunds from Razorpay');
    }
  }

  if (p && p.status === 'created' && age > 20_000 && now - (lastSync.get(ref) ?? 0) > SYNC_INTERVAL_MS) {
    lastSync.set(ref, now);
    if (lastSync.size > 5000) lastSync.clear();
    try {
      await syncPaymentFromRazorpay(ref, 'return');
      p = (await Payment.findOne({ referenceId: ref }).lean<IPayment | null>()) ?? p;
    } catch (error) {
      log.warn({ err: error }, 'status sync with Razorpay failed');
    }
  }

  // Paid but side effects unfinished (e.g. dropped background work): try again now
  // rather than waiting for the daily reconcile. The lease prevents double runs.
  if (p.status === 'paid' && !p.fulfilment?.completedAt && now - new Date(p.paidAt ?? p.createdAt).getTime() > 30_000) {
    const referenceId = p.referenceId;
    after(() => runFulfilment(referenceId).then(() => undefined).catch((error) => log.error({ err: error }, 'fulfilment retry failed')));
  }

  const linkUsable = p.status === 'created' && Boolean(p.razorpay.shortUrl) && new Date(p.expiresAt).getTime() > now;
  return NextResponse.json({
    success: true,
    payment: {
      referenceId: p.referenceId,
      purpose: p.purpose,
      status: p.status,
      orderId: p.orderId,
      templateId: p.templateId,
      templateName: p.template?.name,
      // Only returned once paid: the form is needed to continue document generation
      formData: p.purpose === 'template' && p.status === 'paid' ? p.template?.formData ?? {} : undefined,
      amounts: { subtotal: p.amounts.subtotal, fee: p.amounts.fee, total: p.amounts.total },
      amountRefunded: p.amountRefunded ?? 0,
      paidAt: p.paidAt,
      expiresAt: p.expiresAt,
      paymentUrl: linkUsable ? p.razorpay.shortUrl : undefined,
      fulfilled: Boolean(p.fulfilment?.completedAt),
      needsReview: admin ? p.needsReview : undefined,
    },
  });
}
