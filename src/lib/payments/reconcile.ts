import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment } from '@/models/Payment';
import Order from '@/models/Order';
import { fetchPaymentLink } from '@/lib/payments/razorpayApi';
import { runFulfilment, settlePaid, type SettleSource } from '@/lib/payments/fulfil';
import { MAX_FULFILMENT_ATTEMPTS, UNPAID_ORDER_TTL_HOURS } from '@/lib/payments/config';
import { logger } from '@/lib/logger';

/**
 * Brings one Payment in line with Razorpay by fetching its Payment Link. Used by the
 * status page (when the webhook is late), the reconcile job and admins.
 */
export async function syncPaymentFromRazorpay(referenceId: string, source: SettleSource): Promise<IPayment['status'] | null> {
  await connectDB();
  const p = await Payment.findOne({ referenceId }).lean<IPayment | null>();
  if (!p || !p.razorpay.paymentLinkId) return p?.status ?? null;
  if (p.status !== 'created' && p.status !== 'expired' && p.status !== 'cancelled') return p.status;

  const link = await fetchPaymentLink(p.razorpay.paymentLinkId);
  if (link.status === 'paid') {
    const captured = link.payments?.find((x) => x.status === 'captured') ?? link.payments?.[0];
    if (!captured) return p.status;
    const result = await settlePaid({ paymentLinkId: link.id, razorpayPaymentId: captured.payment_id, amountPaid: link.amount_paid, method: captured.method, source });
    if (result.outcome === 'paid' || result.outcome === 'alreadyPaid') await runFulfilment(referenceId);
    return 'paid';
  }
  if ((link.status === 'expired' || link.status === 'cancelled') && p.status === 'created') {
    await markLinkClosed(link.id, link.status, source);
    return link.status;
  }
  return p.status;
}

/** Webhook / sync: payment_link.expired or payment_link.cancelled. */
export async function markLinkClosed(paymentLinkId: string, status: 'expired' | 'cancelled', source: SettleSource): Promise<boolean> {
  await connectDB();
  const res = await Payment.updateOne(
    { 'razorpay.paymentLinkId': paymentLinkId, status: 'created' },
    { $set: { status }, $push: { events: { at: new Date(), type: `link_${status}`, source } } }
  );
  return res.modifiedCount > 0;
}

export interface ReconcileReport {
  checked: number;
  settled: number;
  closed: number;
  fulfilmentRetried: number;
  ordersCancelled: number;
  errors: number;
}

/**
 * Periodic safety net:
 * 1. links still `created` 10+ minutes after creation → ask Razorpay;
 * 2. paid payments with unfinished side effects → retry them;
 * 3. orders unpaid for UNPAID_ORDER_TTL_HOURS → cancelled.
 */
export async function reconcilePayments({ limit = 50 } = {}): Promise<ReconcileReport> {
  await connectDB();
  const report: ReconcileReport = { checked: 0, settled: 0, closed: 0, fulfilmentRetried: 0, ordersCancelled: 0, errors: 0 };
  const now = Date.now();

  const stale = await Payment.find({ status: 'created', createdAt: { $lt: new Date(now - 10 * 60_000) } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('referenceId')
    .lean<Array<{ referenceId: string }>>();
  for (const { referenceId } of stale) {
    report.checked += 1;
    try {
      const status = await syncPaymentFromRazorpay(referenceId, 'reconcile');
      if (status === 'paid') report.settled += 1;
      else if (status === 'expired' || status === 'cancelled') report.closed += 1;
    } catch (error) {
      report.errors += 1;
      logger.error({ err: error, referenceId }, 'reconcile: sync failed');
    }
  }

  const unfinished = await Payment.find({
    status: { $in: ['paid', 'partially_refunded'] },
    'fulfilment.completedAt': { $exists: false },
    'fulfilment.attempts': { $lt: MAX_FULFILMENT_ATTEMPTS },
    paidAt: { $lt: new Date(now - 2 * 60_000) },
  })
    .limit(limit)
    .select('referenceId')
    .lean<Array<{ referenceId: string }>>();
  for (const { referenceId } of unfinished) {
    try {
      await runFulfilment(referenceId);
      report.fulfilmentRetried += 1;
    } catch (error) {
      report.errors += 1;
      logger.error({ err: error, referenceId }, 'reconcile: fulfilment retry failed');
    }
  }

  const cutoff = new Date(now - UNPAID_ORDER_TTL_HOURS * 3600_000);
  const res = await Order.updateMany(
    { status: 'pending_payment', paymentStatus: 'pending', createdAt: { $lt: cutoff } },
    { $set: { status: 'cancelled', paymentStatus: 'failed' } }
  );
  report.ordersCancelled = res.modifiedCount;

  logger.info(report, 'payment reconcile finished');
  return report;
}
