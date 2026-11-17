import 'server-only';
import connectDB from '@/lib/mongodb';
import Payment, { type IPayment, type PaymentEvent } from '@/models/Payment';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';
import CreatorEarning from '@/models/CreatorEarning';
import { logger } from '@/lib/logger';
import { MAX_FULFILMENT_ATTEMPTS } from '@/lib/payments/config';
import { paiseToRupees } from '@/lib/payments/money';

/**
 * Settling a payment and running its side effects.
 *
 * The return page, the webhook and the reconcile job can all report the same
 * payment, in any order and any number of times:
 * - settlePaid() moves a Payment to `paid` with one conditional update; only the
 *   first caller wins, later callers see `alreadyPaid`.
 * - runFulfilment() performs each side effect once, recording a timestamp in
 *   `fulfilment.<step>` after it succeeds. A failed step is retried on the next run
 *   (reconcile job), up to MAX_FULFILMENT_ATTEMPTS, then flagged for review.
 */
export type SettleSource = PaymentEvent['source'];

export interface SettleInput {
  referenceId?: string;
  paymentLinkId?: string;
  razorpayPaymentId: string;
  amountPaid: number; // paise
  method?: string;
  source: SettleSource;
}

export type SettleResult =
  | { outcome: 'paid' | 'alreadyPaid'; payment: IPayment }
  | { outcome: 'notFound' }
  | { outcome: 'conflict'; payment: IPayment; detail: string };

function event(type: string, source: SettleSource, detail?: string): PaymentEvent {
  return { at: new Date(), type, source, detail };
}

export async function settlePaid(input: SettleInput): Promise<SettleResult> {
  await connectDB();
  const match = input.paymentLinkId
    ? { 'razorpay.paymentLinkId': input.paymentLinkId }
    : { referenceId: input.referenceId };
  if (!input.paymentLinkId && !input.referenceId) return { outcome: 'notFound' };

  const now = new Date();
  // A link can be paid in the last seconds before it expires, or after we cancelled
  // it locally; the money was taken either way, so those states can still settle.
  const updated = await Payment.findOneAndUpdate(
    { ...match, status: { $in: ['created', 'expired', 'cancelled'] }, 'razorpay.paymentId': { $exists: false } },
    {
      $set: {
        status: 'paid',
        paidAt: now,
        amountPaid: input.amountPaid,
        'razorpay.paymentId': input.razorpayPaymentId,
        'razorpay.method': input.method,
      },
      $push: { events: event('paid', input.source, input.razorpayPaymentId) },
    },
    { new: true }
  ).lean<IPayment | null>();

  if (updated) {
    if (updated.amountPaid !== updated.amounts.total) {
      await flagForReview(updated._id, `Amount paid ${updated.amountPaid} paise differs from charged ${updated.amounts.total} paise`);
    }
    logger.info({ referenceId: updated.referenceId, source: input.source }, 'payment settled');
    return { outcome: 'paid', payment: updated };
  }

  const current = await Payment.findOne(match).lean<IPayment | null>();
  if (!current) return { outcome: 'notFound' };
  if (current.razorpay.paymentId === input.razorpayPaymentId) return { outcome: 'alreadyPaid', payment: current };

  // A second, different payment for the same record (e.g. paid twice): needs a refund
  const detail = `Second payment ${input.razorpayPaymentId} received; record already settled by ${current.razorpay.paymentId ?? 'none'} (status ${current.status})`;
  await flagForReview(current._id, detail);
  logger.error({ referenceId: current.referenceId, razorpayPaymentId: input.razorpayPaymentId }, 'duplicate payment for one record');
  return { outcome: 'conflict', payment: current, detail };
}

export async function flagForReview(paymentId: unknown, reason: string): Promise<void> {
  await Payment.updateOne(
    { _id: paymentId as IPayment['_id'] },
    { $set: { needsReview: reason.slice(0, 500) }, $push: { events: event('needs_review', 'system', reason.slice(0, 300)) } }
  );
}

type Step = keyof Omit<IPayment['fulfilment'], 'completedAt' | 'attempts' | 'lastError' | 'lockedUntil' | 'skipped'>;

/** Thrown by a step to end fulfilment without error: there is nothing (more) to do. */
class StopFulfilment extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

const LEASE_MS = 90_000;

async function markStep(paymentId: unknown, step: Step) {
  await Payment.updateOne({ _id: paymentId as IPayment['_id'], [`fulfilment.${step}`]: { $exists: false } }, { $set: { [`fulfilment.${step}`]: new Date() } });
}

// ---------------------------------------------------------------------------
// Print orders
// ---------------------------------------------------------------------------

async function markOrderPaid(p: IPayment) {
  const order = await Order.findOneAndUpdate(
    // An unpaid order cancelled earlier (24 h timeout, or by the customer while its
    // link could not be closed) is revived: the customer has paid for it. Refunded
    // or already-paid orders never match and are flagged below.
    { orderId: p.orderId, paymentStatus: { $in: ['pending', 'failed'] }, status: { $in: ['pending_payment', 'cancelled'] } },
    {
      $set: {
        paymentStatus: 'completed',
        status: 'paid',
        orderStatus: 'pending',
        razorpayPaymentId: p.razorpay.paymentId,
        paymentRef: p.referenceId,
        amountPaid: paiseToRupees(p.amountPaid ?? p.amounts.total),
        paidAt: p.paidAt ?? new Date(),
      },
    },
    { new: true }
  );
  if (!order) {
    const current = await Order.findOne({ orderId: p.orderId }).select('status paymentStatus paymentRef').lean<{ status: string; paymentStatus: string; paymentRef?: string } | null>();
    if (!current) throw new Error(`Order ${p.orderId} not found`);
    const ownedByThis = current.paymentStatus === 'completed' && (current.paymentRef === p.referenceId || !current.paymentRef);
    if (!ownedByThis) {
      // Paid by another attempt (or refunded/cancelled by an admin): never print or email again
      await flagForReview(p._id, `Order ${p.orderId} is ${current.status}/${current.paymentStatus} under ${current.paymentRef ?? 'no payment'}; this payment (${p.razorpay.paymentId}) needs a refund`);
      throw new StopFulfilment('order paid by another payment');
    }
  }
  await closeOtherOpenLinks(p);
}

/** Once an order is paid, close its other open links so the customer can't pay twice. */
async function closeOtherOpenLinks(p: IPayment) {
  const others = await Payment.find({ orderId: p.orderId, status: 'created', referenceId: { $ne: p.referenceId } })
    .select('referenceId razorpay.paymentLinkId')
    .lean<Array<{ _id: unknown; referenceId: string; razorpay: { paymentLinkId?: string } }>>();
  for (const other of others) {
    try {
      if (other.razorpay.paymentLinkId) {
        const { cancelPaymentLink } = await import('@/lib/payments/razorpayApi');
        await cancelPaymentLink(other.razorpay.paymentLinkId);
      }
      await Payment.updateOne({ _id: other._id as IPayment['_id'], status: 'created' }, { $set: { status: 'cancelled' }, $push: { events: event('link_cancelled', 'system', `order paid by ${p.referenceId}`) } });
    } catch (error) {
      // Razorpay refuses to cancel a link that was just paid; settle it so it is flagged
      logger.warn({ err: error, referenceId: other.referenceId }, 'could not cancel other open link');
      const { syncPaymentFromRazorpay } = await import('@/lib/payments/reconcile');
      await syncPaymentFromRazorpay(other.referenceId, 'system').catch(() => undefined);
    }
  }
}

async function dispatchOrder(p: IPayment) {
  const order = await Order.findOne({ orderId: p.orderId });
  if (!order || order.paymentStatus !== 'completed') return;
  if (order.paymentRef && order.paymentRef !== p.referenceId) throw new StopFulfilment('order paid by another payment');
  const { generateDeliveryNumber, sendPrintJobFromOrder } = await import('@/lib/printerClient');
  if (!order.deliveryNumber) {
    order.deliveryNumber = generateDeliveryNumber(1);
    await Order.updateOne({ _id: order._id, deliveryNumber: { $exists: false } }, { $set: { deliveryNumber: order.deliveryNumber } });
  }
  if (order.orderType !== 'file' || !(order.fileURL || order.fileURLs?.length)) return;

  const partnerId = order.deliveryOption?.partnerId || order.partnerId;
  let sent = false;
  if (partnerId) {
    const { dispatchPrintJob } = await import('@/lib/wssClient');
    const result = await dispatchPrintJob(String(partnerId), order.toObject());
    if (!result.ok) throw new Error(`WSS dispatch failed: ${result.error ?? result.status}`);
    sent = result.delivered > 0;
    if (!sent) {
      // The partner sees the order in their order list; Phase 3 adds pull-based delivery
      logger.warn({ orderId: order.orderId, partnerId }, 'partner has no connected device; order stays paid until it is picked up');
      await Payment.updateOne({ _id: p._id }, { $push: { events: event('dispatch_no_device', 'system', String(partnerId)) } });
    }
  } else {
    // Central printer (removed in Phase 3, when every order goes to a partner)
    const result = await sendPrintJobFromOrder(order, 1);
    sent = Boolean(result.success);
    // Retried by the reconcile job; flagged for review after repeated failures
    if (!sent) throw new Error(`Central printer did not accept the job: ${result.message ?? 'no details'}`);
  }
  if (sent) {
    await Order.updateOne({ _id: order._id, status: 'paid' }, { $set: { status: 'printing', orderStatus: 'printing' } });
  }
}

async function createPrintJobRecord(p: IPayment) {
  const order = await Order.findOne({ orderId: p.orderId }).lean<Record<string, any> | null>();
  const fileURL = order?.fileURL || order?.fileURLs?.[0];
  if (!order || order.orderType !== 'file' || !fileURL) return;
  if (await PrintJob.exists({ orderId: String(order._id) })) return;
  const opts = order.printingOptions || {};
  await PrintJob.create({
    orderId: String(order._id),
    orderNumber: order.orderId,
    customerName: order.customerInfo?.name,
    customerEmail: order.customerInfo?.email,
    fileURL,
    fileName: order.originalFileName || order.originalFileNames?.[0] || 'document.pdf',
    fileType: order.fileTypes?.[0] || order.fileType || 'application/pdf',
    printingOptions: {
      pageSize: opts.pageSize || 'A4',
      color: opts.color || 'bw',
      sided: opts.sided || 'single',
      copies: opts.copies || 1,
      pageCount: Math.max(1, opts.pageCount || 1),
    },
    priority: 'normal',
    estimatedDuration: Math.ceil((opts.pageCount || 1) * (opts.copies || 1) * 0.5),
    status: order.status === 'printing' ? 'printing' : 'pending',
  });
}

async function sendInvoice(p: IPayment) {
  const order = await Order.findOne({ orderId: p.orderId });
  if (!order) return;
  const { sendInvoiceEmail } = await import('@/lib/invoiceEmail');
  const ok = await sendInvoiceEmail(order, order.deliveryNumber ?? '');
  if (!ok) throw new Error('Invoice email was not sent');
}

async function notifyAdmin(p: IPayment) {
  const order = await Order.findOne({ orderId: p.orderId }).lean<Record<string, any> | null>();
  if (!order) return;
  const { sendPaymentNotification } = await import('@/lib/notificationService');
  await sendPaymentNotification(
    {
      orderId: order.orderId,
      customerName: order.customerInfo?.name,
      customerEmail: order.customerInfo?.email,
      customerPhone: order.customerInfo?.phone,
      orderType: order.orderType,
      amount: paiseToRupees(p.amountPaid ?? p.amounts.total),
      pageCount: order.printingOptions?.pageCount || 1,
      printingOptions: { pageSize: order.printingOptions?.pageSize, color: order.printingOptions?.color, copies: order.printingOptions?.copies },
      deliveryOption: { type: order.deliveryOption?.type, address: order.deliveryOption?.address, pickupLocation: order.deliveryOption?.pickupLocation?.name },
      createdAt: order.createdAt,
      paymentStatus: 'completed',
      orderStatus: order.orderStatus,
      fileName: order.originalFileName,
    },
    'completed'
  );
}

// ---------------------------------------------------------------------------
// Template purchases
// ---------------------------------------------------------------------------

async function createCreatorEarning(p: IPayment) {
  const creatorUserId = p.template?.creatorUserId;
  if (!creatorUserId || !p.amounts.creatorShare) return;
  if (await CreatorEarning.exists({ razorpayPaymentId: p.razorpay.paymentId })) return;
  await CreatorEarning.create({
    creatorUserId,
    templateId: p.templateId,
    orderId: `template_${p.referenceId}`,
    razorpayPaymentId: p.razorpay.paymentId,
    amount: paiseToRupees(p.amounts.creatorShare),
    platformShareAmount: paiseToRupees(p.amounts.platformShare ?? 0),
    status: 'pending',
    notes: `Template purchase ${p.referenceId}`,
  });
}

// ---------------------------------------------------------------------------

const PLANS: Record<IPayment['purpose'], Array<[Step, (p: IPayment) => Promise<void>]>> = {
  print_order: [
    ['order', markOrderPaid],
    ['dispatch', dispatchOrder],
    ['printJob', createPrintJobRecord],
    ['invoice', sendInvoice],
    ['adminNotice', notifyAdmin],
  ],
  template: [['creatorEarning', createCreatorEarning]],
};

/**
 * Runs the remaining side effects for a paid payment. Safe to call repeatedly and
 * concurrently: a lease (fulfilment.lockedUntil) lets only one run proceed, so the
 * callback, webhook and reconcile job can't dispatch the same job twice.
 */
export async function runFulfilment(referenceId: string): Promise<{ done: boolean; failed: Step[]; busy?: boolean }> {
  await connectDB();
  const now = new Date();
  const p = await Payment.findOneAndUpdate(
    {
      referenceId,
      status: { $in: ['paid', 'partially_refunded'] },
      'fulfilment.completedAt': { $exists: false },
      $or: [{ 'fulfilment.lockedUntil': { $exists: false } }, { 'fulfilment.lockedUntil': null }, { 'fulfilment.lockedUntil': { $lt: now } }],
    },
    { $set: { 'fulfilment.lockedUntil': new Date(now.getTime() + LEASE_MS) } },
    { new: true }
  ).lean<IPayment | null>();
  if (!p) {
    const current = await Payment.findOne({ referenceId }).select('status fulfilment').lean<IPayment | null>();
    if (current?.fulfilment?.completedAt) return { done: true, failed: [] };
    return { done: false, failed: [], busy: Boolean(current && ['paid', 'partially_refunded'].includes(current.status)) };
  }

  const failed: Step[] = [];
  const errors: string[] = [];
  let skipped: string | undefined;
  for (const [step, run] of PLANS[p.purpose]) {
    if (p.fulfilment?.[step]) continue;
    // The order must be marked paid before anything else happens for it
    if (step !== 'order' && failed.includes('order')) {
      failed.push(step);
      continue;
    }
    try {
      await run(p);
      await markStep(p._id, step);
    } catch (error) {
      if (error instanceof StopFulfilment) {
        skipped = error.reason;
        break;
      }
      failed.push(step);
      errors.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
      logger.error({ err: error, referenceId, step }, 'fulfilment step failed');
    }
  }

  const attempts = (p.fulfilment?.attempts ?? 0) + 1;
  const set: Record<string, unknown> = { 'fulfilment.attempts': attempts, 'fulfilment.lockedUntil': null };
  if (failed.length === 0) set['fulfilment.completedAt'] = new Date();
  else set['fulfilment.lastError'] = errors.join('; ').slice(0, 1000);
  if (skipped) set['fulfilment.skipped'] = skipped;
  await Payment.updateOne(
    { _id: p._id },
    { $set: set, $push: { events: event(skipped ? 'fulfilment_skipped' : failed.length ? 'fulfilment_partial' : 'fulfilled', 'system', skipped ?? (failed.join(',') || undefined)) } }
  );

  if (failed.length && attempts >= MAX_FULFILMENT_ATTEMPTS) {
    await flagForReview(p._id, `Fulfilment still failing after ${attempts} attempts: ${errors.join('; ')}`);
  }
  return { done: failed.length === 0, failed };
}
