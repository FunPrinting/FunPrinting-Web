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
import { recoverLegacyOrderPayment, syncPaymentFromRazorpay } from '@/lib/payments/reconcile';

export const runtime = 'nodejs';

const LOCK_MS = 30_000;
const PAID: IPayment['status'][] = ['paid', 'partially_refunded', 'refunded'];

function conflict(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 409 });
}

/**
 * POST /api/orders/[id]/pay — "Complete Payment" for an unpaid order (id = Order.orderId).
 *
 * Reuses the open link if it has more than 2 minutes left; otherwise closes it and
 * creates a new attempt for the amount stored at checkout. The amount never comes
 * from the browser. A short per-order lock stops two tabs creating two links, and
 * a payment that already went through (including old Standard Checkout payments) is
 * found before a new link is created.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const log = withRequestLogger(request, { orderId: id });

  await connectDB();
  const order = await Order.findOne({ orderId: id });
  if (!order || !canAccessOrder(user, order)) {
    return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
  }

  const now = new Date();
  const locked = await Order.findOneAndUpdate(
    { _id: order._id, $or: [{ payLockUntil: { $exists: false } }, { payLockUntil: null }, { payLockUntil: { $lt: now } }] },
    { $set: { payLockUntil: new Date(now.getTime() + LOCK_MS) } },
    { returnDocument: 'after' }
  );
  if (!locked) return conflict('A payment for this order is already being started. Please wait a moment.');

  try {
    if (locked.paymentStatus === 'completed') return conflict('This order is already paid');
    if (locked.status !== 'pending_payment') return conflict('This order can no longer be paid. Please place a new order.');

    // Paid through Standard Checkout before the switch, but the webhook was missed?
    if (locked.razorpayOrderId && (await recoverLegacyOrderPayment(locked.orderId))) {
      return conflict('We found your earlier payment for this order; it is being confirmed now.');
    }
    if (await Payment.exists({ orderId: locked.orderId, status: { $in: PAID } })) {
      return conflict('Payment received; your order is being updated');
    }

    const latest = await Payment.findOne({ orderId: locked.orderId }).sort({ createdAt: -1 }).lean<IPayment | null>();
    if (latest?.status === 'created' && latest.razorpay.shortUrl) {
      if (new Date(latest.expiresAt).getTime() > Date.now() + 2 * 60_000) {
        return NextResponse.json({ success: true, ...toCheckoutResult(latest) });
      }
      // About to expire: close it first. If Razorpay refuses (it was just paid), settle instead.
      try {
        if (latest.razorpay.paymentLinkId) await cancelPaymentLink(latest.razorpay.paymentLinkId);
        await Payment.updateOne({ _id: latest._id, status: 'created' }, { $set: { status: 'cancelled' } });
      } catch (error) {
        log.warn({ err: error, referenceId: latest.referenceId }, 'could not cancel old link; checking it');
        const status = await syncPaymentFromRazorpay(latest.referenceId, 'return');
        if (status && PAID.includes(status)) return conflict('Payment received; your order is being updated');
        if (status === 'created') return NextResponse.json({ success: true, ...toCheckoutResult(latest) });
      }
    }

    const totals =
      locked.pricing?.subtotal !== undefined && locked.pricing.fee !== undefined
        ? (() => {
            const subtotal = rupeesToPaise(locked.pricing!.subtotal);
            const fee = rupeesToPaise(locked.pricing!.fee);
            return { subtotal, fee, total: subtotal + fee };
          })()
        : withProcessingFee(rupeesToPaise(locked.amount)); // orders from before Payment Links

    let partner: { id: string; accountId?: string } | undefined;
    const partnerId = locked.deliveryOption?.partnerId || locked.partnerId;
    if (partnerId) {
      const Partner = (await import('@/models/Partner')).default;
      const doc = await Partner.findOne({ _id: partnerId, isActive: true }).select('razorpayAccountId').lean<{ _id: unknown; razorpayAccountId?: string } | null>();
      if (!doc) return conflict('The print shop for this order is no longer available. Please place a new order.');
      partner = { id: String(doc._id), accountId: doc.razorpayAccountId };
    }

    const payment = await newPaymentAttempt.create({ purpose: 'print_order', user, orderId: locked.orderId, totals, partner });
    const result = await createLinkForPayment(payment, {
      description: `FunPrinting order ${locked.orderId}`,
      customer: { name: locked.customerInfo.name, email: locked.customerInfo.email, contact: locked.customerInfo.phone },
      requestOrigin: request.nextUrl.origin,
    });
    await Order.updateOne({ _id: locked._id }, { $set: { paymentRef: result.referenceId } });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return paymentErrorResponse(error, log, 'Could not start the payment. Please try again.');
  } finally {
    await Order.updateOne({ _id: order._id }, { $set: { payLockUntil: null } }).catch(() => undefined);
  }
}
