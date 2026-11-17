import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment from '@/models/Payment';
import { flagForReview, runFulfilment, settlePaid } from '@/lib/payments/fulfil';
import { markLinkClosed } from '@/lib/payments/reconcile';
import { applyRefundProcessed } from '@/lib/payments/refunds';
import { settleLegacyCapture } from '@/lib/payments/legacy';
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

    case 'payment.captured': {
      const result = await settleLegacyCapture(payload.payment?.entity);
      return { fulfil: result.referenceId ? [result.referenceId] : [], note: result.note };
    }

    default:
      return { fulfil: [], note: `ignored ${event}` };
  }
}

export { runFulfilment };
