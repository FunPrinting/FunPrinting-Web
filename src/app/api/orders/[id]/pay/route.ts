import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canAccessOrder } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Payment, { type IPayment } from '@/models/Payment';
import { cancelPaymentLink } from '@/lib/payments/razorpayApi';
import { createLinkForPayment, newPaymentAttempt, toCheckoutResult } from '@/lib/payments/links';
import { rupeesToPaise, withProcessingFee } from '@/lib/payments/money';
import { paymentErrorResponse } from '@/lib/payments/http';

export const runtime = 'nodejs';

/**
 * POST /api/orders/[id]/pay — "Pay now" for an unpaid order (id = Order.orderId).
 *
 * Reuses the current link if it is still open; otherwise creates a new attempt for
 * the amount stored at checkout. The amount never comes from the browser. Orders
 * created before Payment Links (no stored breakdown) are charged their stored
 * subtotal plus the processing fee, as the old checkout did.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const log = withRequestLogger(request, { orderId: id });

  try {
    await connectDB();
    const order = await Order.findOne({ orderId: id });
    if (!order || !canAccessOrder(user, order)) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (order.paymentStatus === 'completed') {
      return NextResponse.json({ success: false, error: 'This order is already paid' }, { status: 409 });
    }
    if (order.status !== 'pending_payment') {
      return NextResponse.json({ success: false, error: 'This order can no longer be paid. Please place a new order.' }, { status: 409 });
    }

    const latest = await Payment.findOne({ orderId: order.orderId }).sort({ createdAt: -1 }).lean<IPayment | null>();
    if (latest?.status === 'paid') {
      return NextResponse.json({ success: false, error: 'Payment received; your order is being updated' }, { status: 409 });
    }
    if (latest?.status === 'created' && latest.razorpay.shortUrl) {
      if (new Date(latest.expiresAt).getTime() > Date.now() + 2 * 60_000) {
        return NextResponse.json({ success: true, ...toCheckoutResult(latest) });
      }
      // About to expire: close it so the customer can't pay twice
      if (latest.razorpay.paymentLinkId) {
        await cancelPaymentLink(latest.razorpay.paymentLinkId).catch((error) => log.warn({ err: error }, 'could not cancel old link'));
      }
      await Payment.updateOne({ _id: latest._id, status: 'created' }, { $set: { status: 'cancelled' } });
    }

    const totals = order.pricing?.subtotal !== undefined && order.pricing.fee !== undefined
      ? { subtotal: rupeesToPaise(order.pricing.subtotal), fee: rupeesToPaise(order.pricing.fee), total: rupeesToPaise(order.pricing.subtotal) + rupeesToPaise(order.pricing.fee) }
      : withProcessingFee(rupeesToPaise(order.amount));

    let partner: { id: string; accountId?: string } | undefined;
    const partnerId = order.deliveryOption?.partnerId || order.partnerId;
    if (partnerId) {
      const Partner = (await import('@/models/Partner')).default;
      const doc = await Partner.findOne({ _id: partnerId, isActive: true }).select('razorpayAccountId').lean<{ _id: unknown; razorpayAccountId?: string } | null>();
      if (!doc) {
        return NextResponse.json({ success: false, error: 'The print shop for this order is no longer available. Please place a new order.' }, { status: 409 });
      }
      partner = { id: String(doc._id), accountId: doc.razorpayAccountId };
    }

    const payment = await newPaymentAttempt.create({ purpose: 'print_order', user, orderId: order.orderId, totals, partner });
    const result = await createLinkForPayment(payment, {
      description: `FunPrinting order ${order.orderId}`,
      customer: { name: order.customerInfo.name, email: order.customerInfo.email, contact: order.customerInfo.phone },
      requestOrigin: request.nextUrl.origin,
    });
    await Order.updateOne({ _id: order._id }, { $set: { paymentRef: result.referenceId } });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return paymentErrorResponse(error, log, 'Could not start the payment. Please try again.');
  }
}
