import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment from '@/models/Payment';
import Order from '@/models/Order';
import { flagForReview, runFulfilment, settlePaid } from '@/lib/payments/fulfil';
import { markLinkClosed } from '@/lib/payments/reconcile';
import { applyRefundProcessed } from '@/lib/payments/refunds';
import { logger } from '@/lib/logger';

/**
 * Razorpay webhook events. Every handler is idempotent: Razorpay retries until it
 * gets a 2xx and may deliver an event more than once.
 *
 * Returns references whose side effects should run after the response is sent
 * (the webhook must answer within 5 seconds).
 */
export interface RazorpayWebhook {
  event: string;
  payload: {
    payment_link?: { entity: { id: string; reference_id?: string; status: string; amount_paid?: number } };
    payment?: { entity: { id: string; amount: number; status: string; method?: string; order_id?: string; error_description?: string } };
    refund?: { entity: { id: string; payment_id: string; amount: number; status?: string } };
    transfer?: { entity: { id: string; source?: string; recipient?: string } };
  };
}

export async function handleRazorpayEvent(body: RazorpayWebhook): Promise<{ fulfil: string[]; note: string }> {
  await connectDB();
  const { event, payload } = body;

  switch (event) {
    case 'payment_link.paid': {
      const link = payload.payment_link?.entity;
      const payment = payload.payment?.entity;
      if (!link || !payment) return { fulfil: [], note: 'missing entities' };
      const result = await settlePaid({
        paymentLinkId: link.id,
        referenceId: link.reference_id,
        razorpayPaymentId: payment.id,
        amountPaid: link.amount_paid ?? payment.amount,
        method: payment.method,
        source: 'webhook',
      });
      if (result.outcome === 'notFound') {
        logger.warn({ paymentLinkId: link.id, referenceId: link.reference_id }, 'webhook: payment link not found');
        return { fulfil: [], note: 'unknown link' };
      }
      if (result.outcome === 'conflict') return { fulfil: [], note: 'flagged for review' };
      return { fulfil: [result.payment.referenceId], note: result.outcome };
    }

    case 'payment_link.expired':
    case 'payment_link.cancelled': {
      const link = payload.payment_link?.entity;
      if (!link) return { fulfil: [], note: 'missing entity' };
      const changed = await markLinkClosed(link.id, event === 'payment_link.expired' ? 'expired' : 'cancelled', 'webhook');
      return { fulfil: [], note: changed ? 'closed' : 'no change' };
    }

    case 'refund.processed': {
      const refund = payload.refund?.entity;
      if (!refund) return { fulfil: [], note: 'missing entity' };
      const found = await applyRefundProcessed(refund);
      return { fulfil: [], note: found ? 'refund applied' : 'unknown payment' };
    }

    case 'refund.failed': {
      const refund = payload.refund?.entity;
      if (!refund) return { fulfil: [], note: 'missing entity' };
      const p = await Payment.findOne({ 'razorpay.paymentId': refund.payment_id }).select('_id').lean<{ _id: unknown } | null>();
      if (p) await flagForReview(p._id, `Refund ${refund.id} of ${refund.amount} paise failed`);
      return { fulfil: [], note: 'refund failure flagged' };
    }

    case 'transfer.processed': {
      const transfer = payload.transfer?.entity;
      if (transfer?.source) {
        await Payment.updateOne(
          { 'razorpay.paymentId': transfer.source },
          { $set: { 'razorpay.transferId': transfer.id }, $push: { events: { at: new Date(), type: 'transfer_processed', source: 'webhook', detail: transfer.id } } }
        );
      }
      return { fulfil: [], note: 'transfer recorded' };
    }

    case 'payment.captured':
      return handleLegacyCapture(payload.payment?.entity);

    default:
      return { fulfil: [], note: `ignored ${event}` };
  }
}

/**
 * Standard Checkout payments started before the switch to Payment Links: the order
 * has razorpayOrderId and no Payment record. Create one so the same fulfilment runs.
 * Payment Link payments also emit payment.captured; those are skipped here because
 * payment_link.paid settles them.
 */
async function handleLegacyCapture(payment?: { id: string; amount: number; method?: string; order_id?: string }) {
  if (!payment?.order_id) return { fulfil: [], note: 'not a legacy capture' };
  if (await Payment.exists({ 'razorpay.paymentId': payment.id })) return { fulfil: [], note: 'already known' };

  const order = await Order.findOne({ razorpayOrderId: payment.order_id }).lean<{ orderId: string; amount: number; customerInfo?: { email?: string } } | null>();
  if (!order) return { fulfil: [], note: 'no legacy order' }; // a Payment Link payment; handled by payment_link.paid

  const referenceId = `LEGACY_${order.orderId}`.slice(0, 40);
  const subtotal = Math.round(order.amount * 100);
  await Payment.updateOne(
    { referenceId },
    {
      $setOnInsert: {
        referenceId,
        purpose: 'print_order',
        status: 'created',
        userEmail: (order.customerInfo?.email || 'unknown@legacy').toLowerCase(),
        orderId: order.orderId,
        amounts: { subtotal, fee: Math.max(0, payment.amount - subtotal), total: payment.amount },
        currency: 'INR',
        razorpay: {},
        expiresAt: new Date(),
        fulfilment: { attempts: 0 },
        events: [{ at: new Date(), type: 'legacy_checkout', source: 'webhook', detail: payment.order_id }],
      },
    },
    { upsert: true }
  );
  const result = await settlePaid({ referenceId, razorpayPaymentId: payment.id, amountPaid: payment.amount, method: payment.method, source: 'webhook' });
  return result.outcome === 'paid' || result.outcome === 'alreadyPaid'
    ? { fulfil: [referenceId], note: 'legacy capture settled' }
    : { fulfil: [], note: `legacy ${result.outcome}` };
}

export { runFulfilment };
