import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment } from '@/models/Payment';
import Order from '@/models/Order';
import { fetchOrderPayments, fetchPaymentLink, fetchRefund } from '@/lib/payments/razorpayApi';
import { settleLegacyCapture } from '@/lib/payments/legacy';
import { applyRefundProcessed, releasePartnerTransfer } from '@/lib/payments/refunds';
import { STATUS_RANK } from '@/lib/partnerOrderTransitions';
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

/**
 * Order paid through the old Standard Checkout whose webhook was missed: asks
 * Razorpay for the order's payments and settles a captured one. Returns true if a
 * payment was found (fulfilment is then run).
 */
export async function recoverLegacyOrderPayment(orderId: string): Promise<boolean> {
  await connectDB();
  const order = await Order.findOne({ orderId }).select('razorpayOrderId paymentStatus').lean<{ razorpayOrderId?: string; paymentStatus: string } | null>();
  if (!order?.razorpayOrderId || order.paymentStatus === 'completed') return false;
  const payments = await fetchOrderPayments(order.razorpayOrderId);
  const captured = payments.find((p) => p.status === 'captured');
  if (!captured) return false;
  const result = await settleLegacyCapture({ ...captured, order_id: order.razorpayOrderId });
  if (result.referenceId) await runFulfilment(result.referenceId);
  return Boolean(result.referenceId);
}

export interface ReconcileReport {
  checked: number;
  settled: number;
  closed: number;
  fulfilmentRetried: number;
  legacyRecovered: number;
  refundsApplied: number;
  transfersReleased: number;
  jobDeadlines: number;
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
  const report: ReconcileReport = { checked: 0, settled: 0, closed: 0, fulfilmentRetried: 0, legacyRecovered: 0, refundsApplied: 0, transfersReleased: 0, jobDeadlines: 0, ordersCancelled: 0, errors: 0 };
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

  // Old Standard Checkout orders whose capture webhook never arrived (checked before
  // the 24 h cancellation below, so a paid order is never cancelled)
  const legacy = await Order.find({
    status: 'pending_payment',
    razorpayOrderId: { $exists: true, $ne: null },
    paymentRef: { $exists: false },
    createdAt: { $gt: new Date(now - 7 * 24 * 3600_000), $lt: new Date(now - 10 * 60_000) },
  })
    .limit(20)
    .select('orderId')
    .lean<Array<{ orderId: string }>>();
  for (const { orderId } of legacy) {
    try {
      if (await recoverLegacyOrderPayment(orderId)) report.legacyRecovered += 1;
    } catch (error) {
      report.errors += 1;
      logger.error({ err: error, orderId }, 'reconcile: legacy recovery failed');
    }
  }

  // Refunds started but not yet confirmed by a refund.processed webhook
  const refunding = await Payment.find({ 'razorpay.refundIds.0': { $exists: true }, status: { $in: ['paid', 'partially_refunded'] } })
    .limit(limit)
    .select('razorpay')
    .lean<Array<Pick<IPayment, 'razorpay'>>>();
  for (const p of refunding) {
    for (const refundId of p.razorpay.refundIds ?? []) {
      if (p.razorpay.processedRefundIds?.includes(refundId)) continue;
      try {
        const refund = await fetchRefund(refundId);
        if (refund.status === 'processed' && (await applyRefundProcessed({ id: refund.id, payment_id: refund.payment_id, amount: refund.amount }))) {
          report.refundsApplied += 1;
        }
      } catch (error) {
        report.errors += 1;
        logger.error({ err: error, refundId }, 'reconcile: refund check failed');
      }
    }
  }

  // System refunds that Razorpay hasn't accepted yet (e.g. it was down)
  const { processRefundRequest } = await import('@/lib/payments/refunds');
  const requested = await Payment.find({
    'refundRequest.at': { $exists: true },
    'refundRequest.refundId': { $exists: false },
    'refundRequest.attempts': { $lt: 10 },
    status: 'paid',
  })
    .limit(limit)
    .select('referenceId')
    .lean<Array<{ referenceId: string }>>();
  for (const { referenceId } of requested) {
    if (await processRefundRequest(referenceId)) report.refundsApplied += 1;
  }

  // Partner shares still on hold for orders that are printed (or later)
  const held = await Payment.find({
    status: 'paid',
    partnerAccountId: { $exists: true },
    'razorpay.transferReleased': { $ne: true },
    'fulfilment.order': { $exists: true },
  })
    .limit(limit)
    .select('referenceId orderId')
    .lean<Array<{ referenceId: string; orderId?: string }>>();
  for (const p of held) {
    const order = await Order.findOne({ orderId: p.orderId, paymentRef: p.referenceId }).select('status').lean<{ status: string } | null>();
    if (!order || (STATUS_RANK[order.status] ?? -1) < STATUS_RANK.printed) continue;
    try {
      if ((await releasePartnerTransfer(p.referenceId)) === 'released') report.transfersReleased += 1;
    } catch (error) {
      report.errors += 1;
      logger.error({ err: error, referenceId: p.referenceId }, 'reconcile: transfer release failed');
    }
  }

  // Print job deadlines (reassign / refund), in case no QStash message arrived
  try {
    const { sweepDeadlines } = await import('@/lib/jobs/deadlines');
    const jobs = await sweepDeadlines(limit);
    report.jobDeadlines = jobs.accept + jobs.refund;
    report.errors += jobs.errors;
  } catch (error) {
    report.errors += 1;
    logger.error({ err: error }, 'reconcile: job deadline sweep failed');
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
