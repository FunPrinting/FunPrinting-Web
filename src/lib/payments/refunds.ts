import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment } from '@/models/Payment';
import Order from '@/models/Order';
import CreatorEarning from '@/models/CreatorEarning';
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
  const pending = (p.razorpay.refundIds ?? []).filter((id) => !(p.razorpay.processedRefundIds ?? []).includes(id));
  if (pending.length) {
    // Not yet confirmed by Razorpay; starting another could refund twice
    throw new RefundError(`A refund is already in progress (${pending.join(', ')})`, 409);
  }
  const paid = p.amountPaid ?? p.amounts.total;
  const remaining = paid - (p.amountRefunded ?? 0);
  const amount = opts.amountPaise ?? remaining;
  if (!Number.isInteger(amount) || amount < 100 || amount > remaining) {
    throw new RefundError(`Refund must be between ₹1 and ₹${(remaining / 100).toFixed(2)}`);
  }

  const reason = (opts?.reason || 'Order cancelled').slice(0, 200);
  const actor = (opts?.actor || 'system').slice(0, 100);

  const refund = await refundPayment(p.razorpay.paymentId, amount, {
    notes: { referenceId, reason, actor },
    reverseAll: Boolean(p.razorpay.transferId || p.partnerAccountId) && amount === remaining,
  });
  await Payment.updateOne(
    { _id: p._id },
    {
      $addToSet: { 'razorpay.refundIds': refund.id },
      $push: { events: { at: new Date(), type: 'refund_started', source: 'admin', detail: `${refund.id} ${amount} paise by ${actor}: ${reason}`.slice(0, 300) } },
    }
  );
  logger.info({ referenceId, refundId: refund.id, amount }, 'refund started');
  return { refundId: refund.id, amount };
}

/**
 * Refund decided by the system (customer choice, deadline, shop declined). The
 * request is saved first; if Razorpay fails, the reconcile job retries it, so a
 * refund is never silently dropped. Returns the refund id, or null if it will retry.
 */
export async function requestRefund(referenceId: string, opts: { reason?: string; actor?: string }): Promise<string | null> {
  await connectDB();
  const reason = (opts?.reason || 'Order cancelled').slice(0, 200);
  const actor = (opts?.actor || 'system').slice(0, 100);
  await Payment.updateOne(
    { referenceId, $or: [{ refundRequest: { $exists: false } }, { 'refundRequest.refundId': { $exists: false } }] },
    { $set: { refundRequest: { reason, actor, at: new Date(), attempts: 0 } } }
  );
  return processRefundRequest(referenceId);
}

export async function processRefundRequest(referenceId: string): Promise<string | null> {
  const p = await Payment.findOne({ referenceId }).lean<IPayment | null>();
  if (!p?.refundRequest || p.refundRequest.refundId) return p?.refundRequest?.refundId ?? null;
  if (p.status === 'refunded' || p.status === 'partially_refunded') return null;
  const reason = (p.refundRequest.reason || 'Order cancelled').slice(0, 200);
  const actor = (p.refundRequest.actor || 'system').slice(0, 100);
  try {
    const { refundId } = await startRefund(referenceId, { reason, actor });
    await Payment.updateOne({ _id: p._id }, { $set: { 'refundRequest.refundId': refundId }, $inc: { 'refundRequest.attempts': 1 } });
    return refundId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Payment.updateOne({ _id: p._id }, { $set: { 'refundRequest.lastError': message.slice(0, 300) }, $inc: { 'refundRequest.attempts': 1 } });
    // Shown in /admin/errors; the reconcile job retries
    logger.error({ err: error, referenceId }, 'refund request failed; will retry');
    return null;
  }
}

/**
 * refund.processed (webhook or reconcile). Idempotent per refund id, and safe when
 * two refunds are confirmed at the same time: the amount is added atomically.
 */
export async function applyRefundProcessed(refund: { id: string; payment_id: string; amount: number }): Promise<boolean> {
  await connectDB();
  const updated = await Payment.findOneAndUpdate(
    { 'razorpay.paymentId': refund.payment_id, 'razorpay.processedRefundIds': { $ne: refund.id } },
    {
      $inc: { amountRefunded: refund.amount },
      $addToSet: { 'razorpay.processedRefundIds': refund.id, 'razorpay.refundIds': refund.id },
      $push: { events: { at: new Date(), type: 'refund_processed', source: 'webhook', detail: `${refund.id} ${refund.amount}` } },
    },
    { returnDocument: 'after' }
  );
  if (!updated) return Boolean(await Payment.exists({ 'razorpay.paymentId': refund.payment_id }));

  const paid = updated.amountPaid ?? updated.amounts.total;
  const status = (updated.amountRefunded ?? 0) >= paid ? 'refunded' : 'partially_refunded';
  await Payment.updateOne({ _id: updated._id }, { $set: { status } });

  if (status === 'refunded') {
    if (updated.orderId) {
      await Order.updateOne({ orderId: updated.orderId, paymentRef: updated.referenceId }, { $set: { paymentStatus: 'refunded', status: 'refunded' } });
    }
    if (updated.orderId) {
      // A refunded order must not be printed
      const { cancelJobAfterRefund } = await import('@/lib/jobs/deadlines');
      await cancelJobAfterRefund(updated.orderId).catch((error) => logger.error({ err: error, orderId: updated.orderId }, 'could not cancel job after refund'));
    }
    if (updated.purpose === 'template') {
      // The creator is not paid for a refunded sale
      await CreatorEarning.updateMany({ razorpayPaymentId: refund.payment_id, status: 'pending' }, { $set: { status: 'cancelled', notes: `Refunded (${refund.id})` } });
    }
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
  // Never release the partner share of a refunded payment (the refund reverses it)
  if (!p || p.status !== 'paid' || !p.partnerAccountId || !p.razorpay.paymentId) return 'none';
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
