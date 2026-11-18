import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment from '@/models/Payment';
import Order from '@/models/Order';
import { settlePaid } from '@/lib/payments/fulfil';

/**
 * Standard Checkout payments started before the switch to Payment Links: the order
 * has razorpayOrderId and no Payment record. A Payment record is created so the
 * same fulfilment runs. Payment Link payments also emit payment.captured; those are
 * skipped (no legacy order matches) because payment_link.paid settles them.
 */
export async function settleLegacyCapture(payment?: { id: string; amount: number; method?: string; order_id?: string; status?: string }): Promise<{ referenceId?: string; note: string }> {
  if (!payment?.order_id) return { note: 'not a legacy capture' };
  if (payment.status && payment.status !== 'captured') return { note: `legacy payment ${payment.status}` };
  await connectDB();
  if (await Payment.exists({ 'razorpay.paymentId': payment.id })) {
    const known = await Payment.findOne({ 'razorpay.paymentId': payment.id }).select('referenceId').lean<{ referenceId: string } | null>();
    return { referenceId: known?.referenceId, note: 'already known' };
  }

  const order = await Order.findOne({ razorpayOrderId: payment.order_id }).lean<{ orderId: string; amount: number; customerInfo?: { email?: string } } | null>();
  if (!order) return { note: 'no legacy order' };

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
    ? { referenceId, note: 'legacy capture settled' }
    : { note: `legacy ${result.outcome}` };
}
