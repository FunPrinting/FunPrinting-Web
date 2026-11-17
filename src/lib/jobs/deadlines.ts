import 'server-only';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob, { WAITING_JOB_STATUSES, type IPrintJob } from '@/models/PrintJob';
import { getActivePartner } from '@/lib/jobs/assign';
import { announce, event, hashToken, isAcknowledged, JobError } from '@/lib/jobs/service';
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
    { new: true }
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
  await cancelJob(job.orderId, { reason: 'The print shop did not accept your order within 24 hours.', actor: 'system', refund: true });
  return 'refunded';
}

/**
 * Cancels the job (and the order). Before printing starts, anyone allowed to cancel
 * may; once a device is printing, only an admin with `force`.
 */
export async function cancelJob(
  orderId: string,
  opts: { reason: string; actor: string; refund: boolean; force?: boolean }
): Promise<{ cancelled: boolean; refundId?: string }> {
  await connectDB();
  const job = await PrintJob.findOne({ orderId }).lean<IPrintJob | null>();
  const blocked = opts.force ? ['printed', 'cancelled'] : ['claimed', 'printing', 'printed', 'cancelled'];
  if (job && blocked.includes(job.status)) {
    throw new JobError(
      ['claimed', 'printing'].includes(job.status) ? 'The shop has started on this order; please contact support' : `Job is already ${job.status}`,
      409
    );
  }
  if (job) {
    const res = await PrintJob.updateOne(
      { _id: job._id, version: job.version },
      { $set: { status: 'cancelled' }, $unset: { claim: '', acceptBy: '', refundBy: '', customerChoice: '' }, $inc: { version: 1 }, $push: { history: event('cancelled', opts.actor, opts.reason) } }
    );
    if (res.modifiedCount === 0) throw new JobError('Job changed meanwhile; try again', 409);
    if (job.partnerId) await announce(job, job.partnerId, 'cancelled');
  }

  const order = await Order.findOneAndUpdate(
    { orderId, status: { $nin: ['cancelled', 'refunded', 'delivered', 'completed'] } },
    { $set: { status: 'cancelled' } },
    { new: true }
  ).lean<Record<string, any> | null>();

  let refundId: string | undefined;
  const paymentRef = job?.paymentRef ?? order?.paymentRef;
  if (opts.refund && paymentRef && (order?.paymentStatus ?? 'completed') === 'completed') {
    const { startRefund } = await import('@/lib/payments/refunds');
    try {
      refundId = (await startRefund(paymentRef, { reason: opts.reason, actor: opts.actor })).refundId;
    } catch (error) {
      logger.error({ err: error, orderId }, 'automatic refund failed');
      if (job) await PrintJob.updateOne({ _id: job._id }, { $set: { needsAttention: `Refund failed: ${error instanceof Error ? error.message : error}`.slice(0, 300) } });
      throw error;
    }
    if (order?.customerInfo?.email) {
      await sendRefundEmail({ to: order.customerInfo.email, name: order.customerInfo.name, orderId, reason: opts.reason });
    }
  }
  return { cancelled: true, refundId };
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
    await cancelJob(orderId, { reason: 'You asked for a refund because the shop had not accepted your order yet.', actor: 'customer', refund: true });
    return { result: 'refunded' };
  }
  await PrintJob.updateOne({ _id: job._id }, { $push: { history: event('customer_waiting', 'customer') } });
  return { result: 'waiting' };
}

/**
 * Handles every job whose deadline has passed. Runs from the QStash deadline
 * endpoint's fallback, the reconcile cron job, and when partners list their jobs.
 */
export async function sweepDeadlines(limit = 50): Promise<{ accept: number; refund: number; errors: number }> {
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

  const report = { accept: 0, refund: 0, errors: 0 };
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
  return report;
}
