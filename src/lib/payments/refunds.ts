import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment } from '@/models/Payment';
import Order from '@/models/Order';
import { refundPayment, releaseTransfer, fetchPaymentTransfers } from '@/lib/payments/razorpayApi';
import { logger } from '@/lib/logger';

export class RefundError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'RefundError';
  }
}

/**
 * Starts a refund through Razorpay. The money movement is confirmed later by the
 * `refund.processed` webhook (applyRefundProcessed). A held partner transfer is
 * reversed first so the partner share comes back.
 */
export async function startRefund(referenceId: string, opts: { amountPaise?: number; reason: string; actor: string }): Promise<{ refundId: string; amount: number }> {
  await connectDB();
  const p = await Payment.findOne({ referenceId }).lean<IPayment | null>();
  if (!p) throw new RefundError('Payment not found', 404);
  if (!p.razorpay.paymentId || !['paid', 'partially_refunded'].includes(p.status)) {
    throw new RefundError(`Payment is ${p.status}; only paid payments can be refunded`);
  }
  const paid = p.amountPaid ?? p.amounts.total;
  const remaining = paid - (p.amountRefunded ?? 0);
  const amount = opts.amountPaise ?? remaining;
  if (!Number.isInteger(amount) || amount < 100 || amount > remaining) {
    throw new RefundError(`Refund must be between ₹1 and ₹${(remaining / 100).toFixed(2)}`);
  }

  const refund = await refundPayment(p.razorpay.paymentId, amount, {
    notes: { referenceId, reason: opts.reason.slice(0, 200), actor: opts.actor.slice(0, 100) },
    reverseAll: Boolean(p.razorpay.transferId || p.partnerAccountId) && amount === remaining,
  });
  await Payment.updateOne(
    { _id: p._id },
    {
      $addToSet: { 'razorpay.refundIds': refund.id },
      $push: { events: { at: new Date(), type: 'refund_started', source: 'admin', detail: `${refund.id} ${amount} paise by ${opts.actor}: ${opts.reason}`.slice(0, 300) } },
    }
  );
  logger.info({ referenceId, refundId: refund.id, amount }, 'refund started');
  return { refundId: refund.id, amount };
}

/** Webhook: refund.processed. Idempotent per refund id. */
export async function applyRefundProcessed(refund: { id: string; payment_id: string; amount: number }): Promise<boolean> {
  await connectDB();
  const p = await Payment.findOne({ 'razorpay.paymentId': refund.payment_id });
  if (!p) return false;
  if (p.events.some((e) => e.type === 'refund_processed' && e.detail?.startsWith(refund.id))) return true;

  const refunded = (p.amountRefunded ?? 0) + refund.amount;
  const paid = p.amountPaid ?? p.amounts.total;
  p.amountRefunded = refunded;
  p.status = refunded >= paid ? 'refunded' : 'partially_refunded';
  if (!p.razorpay.refundIds?.includes(refund.id)) p.razorpay.refundIds = [...(p.razorpay.refundIds ?? []), refund.id];
  p.events.push({ at: new Date(), type: 'refund_processed', source: 'webhook', detail: `${refund.id} ${refund.amount}` });
  await p.save();

  if (p.orderId && p.status === 'refunded') {
    await Order.updateOne({ orderId: p.orderId, paymentRef: p.referenceId }, { $set: { paymentStatus: 'refunded', status: 'refunded' } });
  }
  return true;
}

/**
 * Releases the partner's held Route transfer once their job is printed. Safe to call
 * more than once and a no-op when the payment has no transfer.
 */
export async function releasePartnerTransfer(referenceId: string): Promise<'released' | 'none' | 'already'> {
  await connectDB();
  const p = await Payment.findOne({ referenceId });
  if (!p || !p.partnerAccountId || !p.razorpay.paymentId) return 'none';
  if (p.razorpay.transferReleased) return 'already';

  let transferId = p.razorpay.transferId;
  if (!transferId) {
    const transfers = await fetchPaymentTransfers(p.razorpay.paymentId);
    transferId = transfers.find((t) => t.recipient === p.partnerAccountId)?.id;
    if (!transferId) return 'none';
  }
  await releaseTransfer(transferId);
  p.razorpay.transferId = transferId;
  p.razorpay.transferReleased = true;
  p.events.push({ at: new Date(), type: 'transfer_released', source: 'system', detail: transferId });
  await p.save();
  return 'released';
}
