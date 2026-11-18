import 'server-only';
import crypto from 'crypto';
import Payment, { type IPayment, type PaymentPurpose } from '@/models/Payment';
import Order from '@/models/Order';
import { createPaymentLink, type RouteTransfer } from '@/lib/payments/razorpayApi';
import { callbackUrl, isRouteEnabled, LINK_TTL_MINUTES } from '@/lib/payments/config';
import { partnerShareOf, type Totals } from '@/lib/payments/money';
import { logger } from '@/lib/logger';
import type { SessionUser } from '@/lib/authz';

export interface CheckoutResult {
  referenceId: string;
  paymentUrl: string;
  orderId?: string;
  amounts: { subtotal: number; fee: number; total: number }; // paise
  expiresAt: string;
}

export function toCheckoutResult(p: Pick<IPayment, 'referenceId' | 'razorpay' | 'orderId' | 'amounts' | 'expiresAt'>): CheckoutResult {
  return {
    referenceId: p.referenceId,
    paymentUrl: p.razorpay.shortUrl || '',
    orderId: p.orderId,
    amounts: { subtotal: p.amounts.subtotal, fee: p.amounts.fee, total: p.amounts.total },
    expiresAt: new Date(p.expiresAt).toISOString(),
  };
}

/**
 * Razorpay reference_id: unique per link, ≤ 40 chars. Order attempts look like
 * ORD123456789_2; template purchases like TPL_<12 random hex>.
 */
async function nextReferenceId(purpose: PaymentPurpose, orderId?: string): Promise<string> {
  if (purpose === 'print_order' && orderId) {
    const attempts = await Payment.countDocuments({ orderId });
    return `${orderId}_${attempts + 1}`.slice(0, 40);
  }
  return `TPL_${crypto.randomBytes(6).toString('hex')}`;
}

export const newPaymentAttempt = {
  /**
   * An earlier attempt with the same idempotency key:
   * - open link → return it;
   * - still being created (no link yet, under 2 minutes old) → 409, try again;
   * - paid → 409;
   * - expired / failed → release the key (and its order) so a new attempt can start.
   */
  async findReusable(userEmail: string, idempotencyKey: string): Promise<CheckoutResult | null> {
    const email = userEmail.toLowerCase();
    const p = await Payment.findOne({ userEmail: email, idempotencyKey }).lean<IPayment | null>();
    if (!p) {
      // The order may exist while its Payment is still being created
      const pending = await Order.exists({ 'customerInfo.email': email, checkoutKey: idempotencyKey, createdAt: { $gt: new Date(Date.now() - 2 * 60_000) } });
      if (pending) throw Object.assign(new Error('Your payment is being prepared. Please try again in a moment.'), { status: 409 });
      return null;
    }
    if (p.status === 'created' && p.razorpay.shortUrl && new Date(p.expiresAt).getTime() > Date.now() + 60_000) {
      return toCheckoutResult(p);
    }
    if (p.status === 'created' && !p.razorpay.shortUrl && Date.now() - new Date(p.createdAt).getTime() < 2 * 60_000) {
      throw Object.assign(new Error('Your payment is being prepared. Please try again in a moment.'), { status: 409 });
    }
    if (p.status === 'paid' || p.status === 'partially_refunded' || p.status === 'refunded') {
      throw Object.assign(new Error('This order has already been paid.'), { status: 409 });
    }
    // Expired or failed attempt: free the key so a fresh attempt can use it
    await Payment.updateOne({ _id: p._id }, { $unset: { idempotencyKey: '' } });
    if (p.orderId) await Order.updateOne({ orderId: p.orderId, checkoutKey: idempotencyKey }, { $unset: { checkoutKey: '' } });
    return null;
  },

  async create(args: {
    purpose: PaymentPurpose;
    user: SessionUser;
    idempotencyKey?: string;
    orderId?: string;
    totals: Totals;
    partner?: { id: string; accountId?: string };
    /** Delivery part of the subtotal (paise) and whether the shop delivers it itself. */
    delivery?: { amount: number; byShop: boolean };
    templateId?: string;
    template?: IPayment['template'];
    creatorShare?: number;
  }) {
    const referenceId = await nextReferenceId(args.purpose, args.orderId);
    const routeTransfer = Boolean(args.partner?.accountId && isRouteEnabled());
    const partnerShare = routeTransfer
      ? partnerShareOf({ subtotal: args.totals.subtotal, delivery: args.delivery?.amount ?? 0, deliveryByShop: Boolean(args.delivery?.byShop) })
      : undefined;
    return Payment.create({
      referenceId,
      purpose: args.purpose,
      status: 'created',
      userId: args.user.id || undefined,
      userEmail: args.user.email,
      idempotencyKey: args.idempotencyKey,
      orderId: args.orderId,
      templateId: args.templateId,
      template: args.template,
      amounts: {
        ...args.totals,
        partnerShare,
        creatorShare: args.creatorShare,
        platformShare: args.totals.subtotal - (partnerShare ?? 0) - (args.creatorShare ?? 0),
      },
      partnerId: args.partner?.id,
      partnerAccountId: routeTransfer ? args.partner?.accountId : undefined,
      razorpay: {},
      expiresAt: new Date(Date.now() + LINK_TTL_MINUTES * 60_000),
      fulfilment: { attempts: 0 },
      events: [{ at: new Date(), type: 'created', source: 'checkout' }],
    });
  },
};

/**
 * Creates the Razorpay Payment Link for a Payment record. Partner share is sent as a
 * Route transfer held until the job is printed (released by releasePartnerTransfer).
 */
export async function createLinkForPayment(
  payment: InstanceType<typeof Payment>,
  opts: {
    description: string;
    customer: { name?: string; email?: string; contact?: string };
    requestOrigin: string;
    onFailure?: () => Promise<void>;
  }
): Promise<CheckoutResult> {
  const transfers: RouteTransfer[] | undefined =
    payment.partnerAccountId && payment.amounts.partnerShare
      ? [
          {
            account: payment.partnerAccountId,
            amount: payment.amounts.partnerShare,
            currency: 'INR',
            notes: { orderId: payment.orderId ?? '', referenceId: payment.referenceId },
            linked_account_notes: ['orderId'],
            on_hold: true,
          },
        ]
      : undefined;

  try {
    const link = await createPaymentLink({
      amount: payment.amounts.total,
      referenceId: payment.referenceId,
      description: opts.description,
      customer: opts.customer,
      callbackUrl: callbackUrl(opts.requestOrigin),
      expireBy: Math.floor(payment.expiresAt.getTime() / 1000),
      notes: { referenceId: payment.referenceId, purpose: payment.purpose, ...(payment.orderId ? { orderId: payment.orderId } : {}) },
      transfers,
    });
    payment.razorpay.paymentLinkId = link.id;
    payment.razorpay.shortUrl = link.short_url;
    payment.events.push({ at: new Date(), type: 'link_created', source: 'checkout', detail: link.id });
    await payment.save();
    return toCheckoutResult(payment);
  } catch (error) {
    logger.error({ err: error, referenceId: payment.referenceId }, 'payment link creation failed');
    payment.status = 'cancelled';
    payment.events.push({ at: new Date(), type: 'link_failed', source: 'checkout', detail: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    await payment.save().catch(() => undefined);
    await opts.onFailure?.().catch(() => undefined);
    throw Object.assign(new Error('Could not start the payment. Please try again in a minute.'), { status: 502 });
  }
}
