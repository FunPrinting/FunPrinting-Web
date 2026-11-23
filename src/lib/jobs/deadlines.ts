import 'server-only';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob, { WAITING_JOB_STATUSES, type IPrintJob } from '@/models/PrintJob';
import { getActivePartner } from '@/lib/jobs/assign';
import { announce, event, hashToken, isAcknowledged, JobError } from '@/lib/jobs/service';
import { STATUS_RANK } from '@/lib/partnerOrderTransitions';
import { sendRefundEmail, sendShopDelayEmail } from '@/lib/jobs/emails';
import { logger } from '@/lib/logger';

/**
 * What happens when a shop doesn't take a job. Orders always stay with the shop the
 * customer chose; they are never moved to another shop.
 *
 * - 10 minutes after assignment without the shop accepting/claiming: the customer is
 *   told and may refund straight away or keep waiting (email link, or My Orders).
 *   The shop can still accept meanwhile.
 * - 24 hours after payment without the shop taking it: refunded automatically.
 * - The shop declines the order: refunded straight away.
 */

function siteUrl(): string {
  return (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || 'https://www.funprinting.store').replace(/\/+$/, '');
}

/** Accept deadline: tell the customer (once) and let them decide. */
export async function handleAcceptDeadline(jobId: string): Promise<string> {
  await connectDB();
  const job = await PrintJob.findOne({ jobId }).lean<IPrintJob | null>();
  if (!job || isAcknowledged(job) || !WAITING_JOB_STATUSES.includes(job.status)) return 'not needed';
  const now = new Date();
  if (job.refundBy && job.refundBy <= now) return handleRefundDeadline(jobId);
  if (job.acceptBy && job.acceptBy > now) return 'not due';
  if (job.customerChoice?.sentAt) return 'already asked';

  const token = crypto.randomBytes(24).toString('base64url');
  const asked = await PrintJob.findOneAndUpdate(
    { _id: job._id, version: job.version, 'customerChoice.sentAt': { $exists: false } },
    {
      $set: { customerChoice: { tokenHash: hashToken(token), sentAt: now } },
      $unset: { acceptBy: '' },
      $inc: { version: 1 },
      $push: { history: event('customer_notified', 'system', 'shop has not accepted yet') },
    },
    { returnDocument: 'after' }
  ).lean<IPrintJob | null>();
  if (!asked) return 'raced';

  await Order.updateOne({ orderId: job.orderId }, { $set: { shopDelayNotifiedAt: now } });
  const order = await Order.findOne({ orderId: job.orderId }).lean<Record<string, any> | null>();
  const shop = job.partnerId ? await getActivePartner(job.partnerId) : null;
  if (order?.customerInfo?.email) {
    await sendShopDelayEmail({
      to: order.customerInfo.email,
      name: order.customerInfo.name,
      orderId: job.orderId,
      shop: shop?.businessName ?? 'Your print shop',
      choiceUrl: `${siteUrl()}/orders/${encodeURIComponent(job.orderId)}/choose?token=${token}`,
      refundBy: job.refundBy,
    });
  }
  return 'customer notified';
}

/** Refund deadline: the shop hasn't taken the job 24 hours after payment. */
export async function handleRefundDeadline(jobId: string): Promise<string> {
  await connectDB();
  const job = await PrintJob.findOne({ jobId }).lean<IPrintJob | null>();
  if (!job || isAcknowledged(job) || !WAITING_JOB_STATUSES.includes(job.status) || !job.refundBy) return 'not needed';
  if (job.refundBy > new Date()) return 'not due';
  await cancelJob(job.orderId, { reason: 'The print shop did not accept your order within 24 hours.', actor: 'system', refund: true, untakenOnly: true });
  return 'refunded';
}

/**
 * Cancels the job (and the order), optionally refunding the customer.
 *
 * - `untakenOnly` (deadlines, customer choice): only if the shop has neither accepted
 *   nor claimed it; checked in the same update, so a shop accepting at the same moment wins.
 * - Without `force`: refused once the shop has started (job claimed/printing, or the
 *   order moved to processing or later from the shop's order list).
 * - `force` (admins): allowed until the job is printed.
 * The refund is recorded before calling Razorpay and retried by reconcile if it fails.
 */
export async function cancelJob(
  orderId: string,
  opts: { reason: string; actor: string; refund: boolean; force?: boolean; untakenOnly?: boolean }
): Promise<{ cancelled: boolean; refundId?: string; refundPending?: boolean }> {
  await connectDB();
  const job = await PrintJob.findOne({ orderId }).lean<IPrintJob | null>();
  const order = await Order.findOne({ orderId }).lean<Record<string, any> | null>();
  if (!order) throw new JobError('Order not found', 404);

  const orderRank = STATUS_RANK[order.status] ?? -1;
  if (!opts.force) {
    if (job && ['claimed', 'printing', 'printed'].includes(job.status)) {
      throw new JobError('The shop has started on this order; please contact support', 409);
    }
    if (orderRank >= STATUS_RANK.processing) throw new JobError(`The order is already ${order.status}`, 409);
  } else if (job?.status === 'printed' || orderRank >= STATUS_RANK.printed) {
    throw new JobError('This order has already been printed', 409);
  }

  if (job && job.status !== 'cancelled') {
    const filter: Record<string, unknown> = { _id: job._id, status: { $nin: ['printed', 'cancelled'] } };
    if (opts.untakenOnly) {
      filter.acceptedAt = { $exists: false };
      filter.firstClaimedAt = { $exists: false };
    }
    if (!opts.force) filter.status = { $in: ['pending_acceptance', 'queued', 'failed'] };
    const res = await PrintJob.updateOne(filter, {
      $set: { status: 'cancelled' },
      $unset: { claim: '', acceptBy: '', refundBy: '', customerChoice: '' },
      $inc: { version: 1 },
      $push: { history: event('cancelled', opts.actor, opts.reason) },
    });
    if (res.modifiedCount === 0) throw new JobError('The shop has just taken this order, so it was not cancelled', 409);
    if (job.partnerId) await announce(job, job.partnerId, 'cancelled');
  }

  await Order.updateOne(
    { orderId, status: { $nin: ['cancelled', 'refunded', 'delivered', 'completed'] } },
    { $set: { status: 'cancelled' }, $unset: { shopDelayNotifiedAt: '' } }
  );

  const paymentRef = job?.paymentRef ?? order.paymentRef;
  if (!opts.refund) {
    if (paymentRef) {
      // Money kept by the platform: a held partner share needs an admin decision
      const { default: Payment } = await import('@/models/Payment');
      await Payment.updateOne({ referenceId: paymentRef, partnerAccountId: { $exists: true } }, { $set: { needsReview: `Order cancelled without refund by ${opts.actor}; partner share still held` } });
    }
    return { cancelled: true };
  }
  if (!paymentRef || order.paymentStatus !== 'completed') return { cancelled: true };

  const { requestRefund } = await import('@/lib/payments/refunds');
  const refundId = await requestRefund(paymentRef, { reason: opts.reason, actor: opts.actor });
  if (order.customerInfo?.email) {
    await sendRefundEmail({ to: order.customerInfo.email, name: order.customerInfo.name, orderId, reason: opts.reason });
  }
  return { cancelled: true, refundId: refundId ?? undefined, refundPending: !refundId };
}

/** The payment was refunded (e.g. by an admin in Razorpay): stop the job unless it is printed. */
export async function cancelJobAfterRefund(orderId: string): Promise<void> {
  await connectDB();
  const job = await PrintJob.findOneAndUpdate(
    { orderId, status: { $nin: ['printed', 'cancelled'] } },
    { $set: { status: 'cancelled' }, $unset: { claim: '', acceptBy: '', refundBy: '', customerChoice: '' }, $inc: { version: 1 }, $push: { history: event('cancelled', 'system', 'payment refunded') } },
    { returnDocument: 'after' }
  ).lean<IPrintJob | null>();
  if (job?.partnerId) await announce(job, job.partnerId, 'cancelled');
}

/**
 * Jobs taken by a device whose lease ran out without a "printed" report: a job
 * already printing is never handed to another device (it could print twice), and
 * jobs taken by the installed app's push/pull have no reports at all. Flag them
 * once for an admin (they show in /admin/errors).
 */
export async function flagStuckJobs(limit = 50): Promise<number> {
  await connectDB();
  const now = new Date();
  const stuck = await PrintJob.find({
    status: { $in: ['claimed', 'printing'] },
    'claim.leaseUntil': { $lt: now },
    needsAttention: { $exists: false },
    $or: [{ status: 'printing' }, { 'claim.deviceId': { $in: ['legacy-push', 'legacy-pull'] } }],
  })
    .limit(limit)
    .select('jobId orderId partnerId status claim')
    .lean<Array<Pick<IPrintJob, 'jobId' | 'orderId' | 'partnerId' | 'status' | 'claim'>>>();
  for (const j of stuck) {
    const note = `No "printed" report from ${j.claim?.deviceId ?? 'device'} (status ${j.status}); check with the shop, then mark printed, resend or cancel`;
    await PrintJob.updateOne({ jobId: j.jobId, needsAttention: { $exists: false } }, { $set: { needsAttention: note } });
    logger.error({ jobId: j.jobId, orderId: j.orderId, partnerId: j.partnerId }, 'print job stuck without a printed report');
  }
  return stuck.length;
}

/**
 * Customer's decision while the shop hasn't accepted: refund now, or keep waiting
 * (the 24-hour automatic refund still applies). Authorised by the emailed token or
 * by being the signed-in owner of the order (`ownerVerified`).
 */
export async function answerCustomerChoice(
  orderId: string,
  auth: { token?: string; ownerVerified?: boolean },
  choice: 'refund' | 'wait'
): Promise<{ result: 'refunded' | 'waiting' }> {
  await connectDB();
  const filter: Record<string, unknown> = { orderId, status: { $in: WAITING_JOB_STATUSES }, 'customerChoice.sentAt': { $exists: true } };
  if (!auth.ownerVerified) {
    if (!auth.token) throw new JobError('This link is no longer valid', 410);
    filter['customerChoice.tokenHash'] = hashToken(auth.token);
  }
  const job = await PrintJob.findOne(filter).lean<IPrintJob | null>();
  if (!job || isAcknowledged(job)) throw new JobError('The shop has already accepted this order, or the link is no longer valid', 410);

  if (choice === 'refund') {
    await cancelJob(orderId, { reason: 'You asked for a refund because the shop had not accepted your order yet.', actor: 'customer', refund: true, untakenOnly: true });
    return { result: 'refunded' };
  }
  await PrintJob.updateOne({ _id: job._id }, { $push: { history: event('customer_waiting', 'customer') } });
  return { result: 'waiting' };
}

/**
 * Handles every job whose deadline has passed. Runs from the QStash deadline
 * endpoint's fallback, the reconcile cron job, and when partners list their jobs.
 */
export async function sweepDeadlines(limit = 50): Promise<{ accept: number; refund: number; stuck: number; errors: number }> {
  await connectDB();
  const now = new Date();
  const due = await PrintJob.find({
    status: { $in: WAITING_JOB_STATUSES },
    $or: [{ acceptBy: { $lte: now } }, { refundBy: { $lte: now } }],
  })
    .sort({ refundBy: 1 })
    .limit(limit)
    .select('jobId acceptBy refundBy')
    .lean<Array<Pick<IPrintJob, 'jobId' | 'acceptBy' | 'refundBy'>>>();

  const report = { accept: 0, refund: 0, stuck: 0, errors: 0 };
  for (const j of due) {
    try {
      if (j.refundBy && j.refundBy <= now) {
        if ((await handleRefundDeadline(j.jobId)) === 'refunded') report.refund += 1;
      } else if ((await handleAcceptDeadline(j.jobId)) === 'customer notified') {
        report.accept += 1;
      }
    } catch (error) {
      report.errors += 1;
      logger.error({ err: error, jobId: j.jobId }, 'job deadline handling failed');
    }
  }
  report.stuck = await flagStuckJobs(limit).catch(() => 0);
  return report;
}
