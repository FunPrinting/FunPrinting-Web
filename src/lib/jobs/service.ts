import 'server-only';
import crypto from 'crypto';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob, { ACTIVE_JOB_STATUSES, type IPrintJob, type JobEvent, type JobFile, type JobStatus } from '@/models/PrintJob';
import PartnerDevice from '@/models/PartnerDevice';
import { STATUS_RANK } from '@/lib/partnerOrderTransitions';
import { getActivePartner } from '@/lib/jobs/assign';
import { scheduleDeadline } from '@/lib/jobs/scheduler';
import { generateDeliveryNumber } from '@/lib/jobs/deliveryNumber';
import { logger } from '@/lib/logger';
import { isPdf, isPrintReady, preparePrintFiles, PRINT_READY_FILTER } from '@/lib/jobs/printReady';

/**
 * Print jobs: one per paid order, owned by one partner at a time.
 *
 * Partner devices pull work: list → (accept) → claim → printing → printed.
 * A claim is a lease (CLAIM_LEASE_MS) renewed by status reports, so a device that
 * disappears releases the job for another device of the same shop. The socket
 * server only says "your job list changed"; it never carries the job itself.
 *
 * Deadlines (until the shop acknowledges the job by accepting or claiming it):
 *   ACCEPT_WINDOW_MS after assignment → the customer may refund now or keep waiting
 *   REFUND_WINDOW_MS after payment     → automatic refund (deadlines.ts)
 * Jobs always stay with the customer's chosen shop.
 */
export const ACCEPT_WINDOW_MS = 10 * 60_000;
export const REFUND_WINDOW_MS = 24 * 60 * 60_000;
export const CLAIM_LEASE_MS = 5 * 60_000;
export const MAX_PRINT_FAILURES = 3;

export class JobError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'JobError';
  }
}

export function event(type: string, actor: string, detail?: string): JobEvent {
  return { at: new Date(), type, actor, detail: detail?.slice(0, 300) };
}

/** True once the shop has taken responsibility, so no deadline applies. */
export function isAcknowledged(job: Pick<IPrintJob, 'acceptedAt' | 'firstClaimedAt'>): boolean {
  return Boolean(job.acceptedAt || job.firstClaimedAt);
}

// ---------------------------------------------------------------------------
// Order ↔ job status
// ---------------------------------------------------------------------------

const ORDER_STATUS_FOR_JOB: Partial<Record<JobStatus, { status: string; orderStatus: string }>> = {
  pending_acceptance: { status: 'paid', orderStatus: 'pending' },
  queued: { status: 'paid', orderStatus: 'pending' },
  claimed: { status: 'processing', orderStatus: 'processing' },
  printing: { status: 'printing', orderStatus: 'printing' },
  printed: { status: 'printed', orderStatus: 'printed' },
};

/** Moves the order forward to match the job; never backwards (a shop may be ahead). */
export async function syncOrderFromJob(orderId: string, jobStatus: JobStatus, extra: Record<string, unknown> = {}): Promise<void> {
  const target = ORDER_STATUS_FOR_JOB[jobStatus];
  if (!target) return;
  const allowedFrom = Object.entries(STATUS_RANK)
    .filter(([, rank]) => rank < STATUS_RANK[target.status])
    .map(([s]) => s);
  await Order.updateOne(
    { orderId, status: { $in: allowedFrom } },
    { $set: { status: target.status, orderStatus: target.orderStatus, ...(jobStatus === 'printed' ? { printedAt: new Date() } : {}), ...extra } }
  );
}

// ---------------------------------------------------------------------------
// Creation and assignment
// ---------------------------------------------------------------------------

function filesFromOrder(order: Record<string, any>): JobFile[] {
  const urls: string[] = order.fileURLs?.length ? order.fileURLs : order.fileURL ? [order.fileURL] : [];
  const opts = order.printingOptions || {};
  return urls.map((url, i) => {
    const fo = opts.fileOptions?.[i] || {};
    const colors = Array.isArray(opts.pageColors) ? opts.pageColors[i] : i === 0 ? opts.pageColors : undefined;
    const name = order.originalFileNames?.[i] || (i === 0 ? order.originalFileName : undefined) || `File ${i + 1}`;
    const mime = order.fileTypes?.[i] || order.fileType;
    return {
      url,
      // Set at upload; PDFs from older orders are print-ready as they are
      printUrl: order.printURLs?.[i] || (isPdf(mime, name, url) ? url : undefined),
      name,
      mime,
      pages: order.pricing?.files?.[i]?.pages,
      pageSize: fo.pageSize || opts.pageSize || 'A4',
      color: fo.color || opts.color || 'bw',
      sided: fo.sided || opts.sided || 'single',
      copies: fo.copies || opts.copies || 1,
      colorPages: colors?.colorPages?.length ? colors.colorPages : undefined,
    };
  });
}

/** Partner, mode and deadlines for a fresh assignment. */
export function assignmentFields(partner: { _id: string; acceptanceMode: 'auto' | 'manual' }, now = new Date()) {
  return {
    partnerId: partner._id,
    acceptanceMode: partner.acceptanceMode,
    status: (partner.acceptanceMode === 'manual' ? 'pending_acceptance' : 'queued') as JobStatus,
    assignedAt: now,
    acceptBy: new Date(now.getTime() + ACCEPT_WINDOW_MS),
    acceptedAt: undefined,
    firstClaimedAt: undefined,
    claim: undefined,
  };
}

/**
 * Creates the job for a paid order (idempotent: one job per order) and tells the
 * shop. Called by payment fulfilment. `legacy` jobs (orders paid before jobs
 * existed, created on demand by admins) get no automatic refund deadline.
 */
export async function createJobForOrder(orderId: string, opts: { paymentRef?: string; paidAt?: Date; legacy?: boolean; actor?: string } = {}): Promise<IPrintJob> {
  await connectDB();
  const existing = await PrintJob.findOne({ orderId }).lean<IPrintJob | null>();
  if (existing) {
    // A crash after creation may have skipped scheduling or the notice; both are safe to repeat
    if (existing.acceptBy) await scheduleDeadline(existing.jobId, 'accept', existing.acceptBy, existing.version);
    if (existing.refundBy) await scheduleDeadline(existing.jobId, 'refund', existing.refundBy, existing.version);
    if (existing.partnerId && ['pending_acceptance', 'queued'].includes(existing.status)) {
      const { notifyPartnerJobs } = await import('@/lib/wssClient');
      await notifyPartnerJobs(existing.partnerId, 'new').catch(() => undefined);
    }
    return existing;
  }

  const order = await Order.findOne({ orderId }).lean<Record<string, any> | null>();
  if (!order) throw new JobError(`Order ${orderId} not found`, 404);
  if (order.paymentStatus !== 'completed') throw new JobError(`Order ${orderId} is not paid`, 409);
  const files = filesFromOrder(order);
  if (!files.length) throw new JobError(`Order ${orderId} has no files to print`, 409);

  const partnerId = String(order.deliveryOption?.partnerId || order.partnerId || '');
  const partner = partnerId ? await getActivePartner(partnerId) : null;
  const now = new Date();
  const paidAt = new Date(opts.paidAt ?? order.paidAt ?? now);
  const deliveryNumber = order.deliveryNumber || generateDeliveryNumber(now);
  const actor = opts.actor ?? 'system';

  // How far the order already got (e.g. printed by hand, or by the installed app
  // before jobs existed). Such orders are never given deadlines or auto-refunds.
  const orderRank = STATUS_RANK[order.status] ?? -1;
  const progressed = orderRank >= STATUS_RANK.processing;
  const refundBy = new Date(paidAt.getTime() + REFUND_WINDOW_MS);
  const deadlinesApply = !opts.legacy && !progressed && refundBy.getTime() > now.getTime() + ACCEPT_WINDOW_MS;

  const base = {
    jobId: `J${orderId}`,
    orderId,
    paymentRef: opts.paymentRef ?? order.paymentRef,
    deliveryType: (order.deliveryOption?.type === 'delivery' ? 'delivery' : 'pickup') as 'pickup' | 'delivery',
    files,
    service: order.printingOptions?.serviceOptions,
    deliveryNumber,
    customerInfo: order.customerInfo ? {
      name: order.customerInfo.name,
      phone: order.customerInfo.phone,
      email: order.customerInfo.email,
    } : undefined,
    deliveryOption: order.deliveryOption ? {
      type: order.deliveryOption.type,
      method: order.deliveryOption.method,
      partnerDeliveryPoint: order.deliveryOption.partnerDeliveryPoint,
      recipientName: order.deliveryOption.recipientName,
      recipientPhone: order.deliveryOption.recipientPhone,
      address: order.deliveryOption.address,
      flatBuilding: order.deliveryOption.flatBuilding,
      city: order.deliveryOption.city,
      state: order.deliveryOption.state,
      pinCode: order.deliveryOption.pinCode,
    } : undefined,
    amount: order.pricing?.totalPrice ?? order.amount,
    expectedDate: order.expectedDate ? String(order.expectedDate) : undefined,
    rejections: [],
    version: 0,
  };

  let doc: Record<string, unknown>;
  if (progressed) {
    const status: JobStatus = orderRank >= STATUS_RANK.printed ? 'printed' : orderRank >= STATUS_RANK.printing ? 'printing' : 'claimed';
    doc = {
      ...base,
      partnerId: partnerId || undefined,
      acceptanceMode: partner?.acceptanceMode,
      status,
      assignedAt: now,
      firstClaimedAt: now,
      ...(status === 'printed' ? { printedAt: order.printedAt ?? now } : {}),
      history: [event('created', actor, `order already ${order.status}; no deadlines`)],
    };
  } else if (!partner) {
    doc = {
      ...base,
      partnerId: partnerId || undefined,
      status: 'pending_acceptance',
      needsAttention: `Shop ${partnerId || '(none)'} is not active; cancel and refund, or reactivate the shop`,
      history: [event('created', actor, `shop ${partnerId || 'none'} is not active`)],
    };
  } else {
    doc = {
      ...base,
      ...assignmentFields(partner, now),
      ...(deadlinesApply ? { refundBy } : { acceptBy: undefined }),
      history: [event('created', actor, `assigned to ${partner._id} (${partner.acceptanceMode})${deadlinesApply ? '' : '; no deadlines'}`)],
    };
  }

  let job: IPrintJob;
  try {
    job = (await PrintJob.create(doc)).toObject();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return (await PrintJob.findOne({ orderId }).lean<IPrintJob>())!;
    throw error;
  }
  await Order.updateOne({ orderId, deliveryNumber: { $exists: false } }, { $set: { deliveryNumber } });

  if (!progressed && !partner) {
    // Checkout only accepts approved shops; the shop was deactivated since. Refund a
    // fresh order automatically; anything older is left for an admin.
    if (deadlinesApply) {
      const { cancelJob } = await import('@/lib/jobs/deadlines');
      await cancelJob(orderId, { reason: 'Your print shop is no longer taking orders.', actor: 'system', refund: true }).catch((error) =>
        logger.error({ err: error, orderId }, 'refund for inactive shop failed')
      );
    } else {
      logger.error({ orderId, partnerId }, 'paid order has no active shop; needs an admin');
    }
    return (await PrintJob.findById(job._id).lean<IPrintJob>())!;
  }
  if (progressed) return job;

  // Older orders with Word files or images: make the PDFs now, so the shop can claim the job
  if (!isPrintReady(job)) {
    await preparePrintFiles(job.jobId).catch((error) => logger.error({ err: error, jobId: job.jobId }, 'preparing print files failed'));
  }

  if (job.acceptBy) await scheduleDeadline(job.jobId, 'accept', job.acceptBy, job.version);
  if (job.refundBy) await scheduleDeadline(job.jobId, 'refund', job.refundBy, job.version);
  await announce(job, partner!._id, 'new');
  logger.info({ jobId: job.jobId, orderId, partnerId: job.partnerId, status: job.status }, 'print job created');
  return job;
}

/**
 * Tells the shop's devices that their job list changed. Devices fetch their jobs from
 * /api/partner/v1/jobs; the socket carries no job data.
 */
export async function announce(_job: IPrintJob, partnerId: string, reason: 'new' | 'updated' | 'cancelled'): Promise<void> {
  const { notifyPartnerJobs } = await import('@/lib/wssClient');
  await notifyPartnerJobs(partnerId, reason).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Partner actions (pull model)
// ---------------------------------------------------------------------------

export interface PartnerActor {
  partnerId: string;
  deviceId?: string;
}

const actorLabel = (a: PartnerActor) => (a.deviceId ? `device:${a.deviceId}` : `partner:${a.partnerId}`);

async function loadOwned(jobId: string, partnerId: string) {
  await connectDB();
  const job = await PrintJob.findOne({ jobId, partnerId });
  if (!job) throw new JobError('Job not found', 404);
  return job;
}

export async function listPartnerJobs(partnerId: string, scope: 'active' | 'history', limit = 50) {
  await connectDB();
  const statuses = scope === 'active' ? ACTIVE_JOB_STATUSES : (['printed', 'cancelled'] as JobStatus[]);
  return PrintJob.find({ partnerId, status: { $in: statuses } })
    .sort({ createdAt: scope === 'active' ? 1 : -1 })
    .limit(Math.min(limit, 200))
    .select('-history -customerChoice -rejections')
    .lean<IPrintJob[]>();
}

/** Manual-mode shops accept an order before it enters their print queue. */
export async function acceptJob(jobId: string, actor: PartnerActor): Promise<IPrintJob> {
  const job = await loadOwned(jobId, actor.partnerId);
  if (job.status !== 'pending_acceptance') throw new JobError(`Job is ${job.status}`, 409);
  const updated = await PrintJob.findOneAndUpdate(
    { _id: job._id, status: 'pending_acceptance', partnerId: actor.partnerId },
    {
      $set: { status: 'queued', acceptedAt: new Date() },
      $unset: { acceptBy: '', refundBy: '' },
      $inc: { version: 1 },
      $push: { history: event('accepted', actorLabel(actor)) },
    },
    { returnDocument: 'after' }
  ).lean<IPrintJob | null>();
  if (!updated) throw new JobError('Job changed meanwhile; reload and try again', 409);
  await Order.updateOne({ orderId: updated.orderId }, { $unset: { shopDelayNotifiedAt: '' } });
  await announce(updated, actor.partnerId, 'updated');
  return updated;
}

/** The shop declines: the customer is refunded straight away (orders never move shops). */
export async function rejectJob(jobId: string, actor: PartnerActor, reason?: string): Promise<IPrintJob> {
  const job = await loadOwned(jobId, actor.partnerId);
  if (!['pending_acceptance', 'queued'].includes(job.status)) throw new JobError(`A job that is ${job.status} can't be declined`, 409);
  await PrintJob.updateOne(
    { _id: job._id },
    { $push: { rejections: { partnerId: actor.partnerId, reason: reason?.slice(0, 200), at: new Date() }, history: event('rejected', actorLabel(actor), reason) } }
  );
  const { cancelJob } = await import('@/lib/jobs/deadlines');
  await cancelJob(job.orderId, { reason: 'The print shop could not take your order.', actor: actorLabel(actor), refund: true });
  return (await PrintJob.findById(job._id).lean<IPrintJob>())!;
}

/**
 * A device takes a job to print: `jobId`, or the oldest queued job. Fails if
 * another device holds an unexpired lease. Returns the job with its files.
 */
export async function claimJob(actor: Required<PartnerActor>, jobId?: string): Promise<IPrintJob | null> {
  await connectDB();
  const now = new Date();
  const claimable: Record<string, unknown> = {
    partnerId: actor.partnerId,
    // Partner apps print only PDFs; a job waits until every file has one
    ...PRINT_READY_FILTER,
    $or: [
      { status: 'queued' },
      // lease expired before printing started (a job already printing is never taken
      // over, so it can't be printed twice; the sweep flags it instead), or the same
      // device asking again
      { status: { $in: ['claimed', 'failed'] }, 'claim.leaseUntil': { $lt: now } },
      { status: { $in: ['claimed', 'printing'] }, 'claim.deviceId': actor.deviceId },
      { status: 'failed', claim: { $exists: false } },
    ],
  };
  const job = await PrintJob.findOneAndUpdate(
    jobId ? { ...claimable, jobId } : claimable,
    [
      {
        $set: {
          status: { $cond: [{ $eq: ['$status', 'printing'] }, 'printing', 'claimed'] },
          claim: { deviceId: { $literal: actor.deviceId }, leaseUntil: new Date(now.getTime() + CLAIM_LEASE_MS) },
          firstClaimedAt: { $ifNull: ['$firstClaimedAt', now] },
          acceptBy: '$$REMOVE',
          refundBy: '$$REMOVE',
          version: { $add: ['$version', 1] },
          history: { $concatArrays: ['$history', [{ $literal: event('claimed', actorLabel(actor)) }]] },
        },
      },
    ],
    { returnDocument: 'after', sort: { createdAt: 1 }, updatePipeline: true }
  ).lean<IPrintJob | null>();
  if (!job) {
    if (jobId && (await PrintJob.exists({ jobId, partnerId: actor.partnerId }))) {
      throw new JobError('This job is being printed by another device or is not ready', 409);
    }
    return null;
  }
  await syncOrderFromJob(job.orderId, 'claimed', { shopDelayNotifiedAt: null });
  return job;
}

export type DeviceReport = 'printing' | 'printed' | 'failed' | 'release';

/**
 * Progress from the device holding the claim. Each report renews the lease.
 * - printing: printing started / still printing (heartbeat)
 * - printed: done → order printed, partner payout released
 * - failed: put back in the queue; flagged after MAX_PRINT_FAILURES
 * - release: give the job back without printing (e.g. printer offline)
 */
export async function reportJob(jobId: string, actor: Required<PartnerActor>, report: DeviceReport, error?: string, printer?: string): Promise<IPrintJob> {
  const job = await loadOwned(jobId, actor.partnerId);
  if (job.claim?.deviceId !== actor.deviceId || !['claimed', 'printing'].includes(job.status)) {
    throw new JobError('This device does not hold the job; claim it first', 409);
  }
  const now = new Date();
  const guard: Record<string, unknown> = { _id: job._id, partnerId: actor.partnerId, 'claim.deviceId': actor.deviceId, status: { $in: ['claimed', 'printing'] } };
  let update: Record<string, unknown>;
  const printerName = printer?.trim().slice(0, 200) || job.claim?.printer;
  const on = printerName ? ` on ${printerName}` : '';
  if (report === 'printing') {
    update = {
      $set: { status: 'printing', 'claim.leaseUntil': new Date(now.getTime() + CLAIM_LEASE_MS), ...(printerName ? { 'claim.printer': printerName } : {}) },
      ...(job.status !== 'printing' ? { $push: { history: event('printing', actorLabel(actor), printerName) } } : {}),
    };
  } else if (report === 'printed') {
    const device = await PartnerDevice.findOne({ deviceId: actor.deviceId }).select('name').lean<{ name?: string } | null>();
    update = {
      $set: { status: 'printed', printedAt: now, printedBy: { deviceId: actor.deviceId, deviceName: device?.name, printer: printerName } },
      $unset: { claim: '' },
      $inc: { version: 1 },
      $push: { history: event('printed', actorLabel(actor), `${device?.name ?? 'device'}${on}`) },
    };
  } else if (report === 'release') {
    update = { $set: { status: 'queued' }, $unset: { claim: '' }, $inc: { version: 1 }, $push: { history: event('released', actorLabel(actor), [error, printerName].filter(Boolean).join(' · ') || undefined) } };
  } else {
    const failures = job.history.filter((h) => h.type === 'failed').length + 1;
    update = {
      $set: { status: 'failed', lastError: (error || 'Print failed').slice(0, 500), ...(failures >= MAX_PRINT_FAILURES ? { needsAttention: `Failed ${failures} times: ${error ?? ''}`.slice(0, 300) } : {}) },
      $unset: { claim: '' },
      $inc: { version: 1 },
      $push: { history: event('failed', actorLabel(actor), [error, printerName && `printer: ${printerName}`].filter(Boolean).join(' · ') || undefined) },
    };
  }
  const updated = await PrintJob.findOneAndUpdate(guard, update, { returnDocument: 'after' }).lean<IPrintJob | null>();
  if (!updated) throw new JobError('Job changed meanwhile; reload and try again', 409);

  if (report === 'printing') await syncOrderFromJob(updated.orderId, 'printing');
  if (report === 'printed') await onPrinted(updated);
  if (report === 'failed' && updated.needsAttention) logger.error({ jobId, error }, 'print job keeps failing');
  return updated;
}

export async function onPrinted(job: IPrintJob): Promise<void> {
  await syncOrderFromJob(job.orderId, 'printed');
  if (job.paymentRef) {
    const { releasePartnerTransfer } = await import('@/lib/payments/refunds');
    await releasePartnerTransfer(job.paymentRef).catch((error) => logger.error({ err: error, jobId: job.jobId }, 'transfer release failed'));
  }
}

/**
 * A shop moved the order forward from its order list (web dashboard, mobile app,
 * current desktop app) instead of through the job API. Keep the job in step.
 */
export async function syncJobFromOrderStatus(orderId: string, orderStatus: string, actor: string): Promise<void> {
  await connectDB();
  const job = await PrintJob.findOne({ orderId }).lean<IPrintJob | null>();
  const rank = STATUS_RANK[orderStatus] ?? -1;
  if (!job) {
    // Orders paid before print jobs existed: release the held share directly
    if (rank >= STATUS_RANK.printed) {
      const order = await Order.findOne({ orderId }).select('paymentRef').lean<{ paymentRef?: string } | null>();
      if (order?.paymentRef) {
        const { releasePartnerTransfer } = await import('@/lib/payments/refunds');
        await releasePartnerTransfer(order.paymentRef).catch(() => undefined);
      }
    }
    return;
  }
  if (['printed', 'cancelled'].includes(job.status)) return;
  await Order.updateOne({ orderId }, { $unset: { shopDelayNotifiedAt: '' } });
  const now = new Date();
  if (rank >= STATUS_RANK.printed) {
    const updated = await PrintJob.findOneAndUpdate(
      { _id: job._id, status: { $nin: ['printed', 'cancelled'] } },
      { $set: { status: 'printed', printedAt: now, firstClaimedAt: job.firstClaimedAt ?? now }, $unset: { claim: '', acceptBy: '', refundBy: '' }, $inc: { version: 1 }, $push: { history: event('printed', actor, `order set to ${orderStatus}`) } },
      { returnDocument: 'after' }
    ).lean<IPrintJob | null>();
    if (updated?.paymentRef) {
      const { releasePartnerTransfer } = await import('@/lib/payments/refunds');
      await releasePartnerTransfer(updated.paymentRef).catch(() => undefined);
    }
  } else if (rank >= STATUS_RANK.printing) {
    await PrintJob.updateOne(
      { _id: job._id, status: { $in: ['pending_acceptance', 'queued', 'claimed', 'failed'] } },
      { $set: { status: 'printing', firstClaimedAt: job.firstClaimedAt ?? now }, $unset: { acceptBy: '', refundBy: '' }, $inc: { version: 1 }, $push: { history: event('printing', actor, `order set to ${orderStatus}`) } }
    );
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * Puts a job back in its shop's queue (admin "Send to shop"). Creates a job (without
 * deadlines) for orders paid before jobs existed. A job a device has taken or
 * printed is only re-queued with `force`, since that prints it again.
 */
export async function resendJob(orderId: string, adminEmail: string, force = false): Promise<IPrintJob> {
  await connectDB();
  let job = await PrintJob.findOne({ orderId }).lean<IPrintJob | null>();
  if (!job) {
    const created = await createJobForOrder(orderId, { legacy: true, actor: `admin:${adminEmail}` });
    if (created.status !== 'queued' && created.status !== 'pending_acceptance') {
      throw new JobError(`Recorded the order's print job as ${created.status}; use force to print it again`, 409);
    }
    return created;
  }
  if (job.status === 'cancelled') throw new JobError('This job was cancelled', 409);
  if (!job.partnerId || !(await getActivePartner(job.partnerId))) throw new JobError("This order's shop is not active", 409);
  const now = new Date();
  const takenAndLive = ['claimed', 'printing'].includes(job.status) && job.claim?.leaseUntil && new Date(job.claim.leaseUntil) > now;
  if (!force && (job.status === 'printed' || takenAndLive || job.status === 'printing')) {
    throw new JobError(`Job is ${job.status}; resending would print it again. Use force to do that.`, 409);
  }
  job = await PrintJob.findOneAndUpdate(
    { _id: job._id, version: job.version },
    { $set: { status: 'queued' }, $unset: { claim: '', needsAttention: '' }, $inc: { version: 1 }, $push: { history: event(force ? 'resent_forced' : 'resent', `admin:${adminEmail}`) } },
    { returnDocument: 'after' }
  ).lean<IPrintJob | null>();
  if (!job) throw new JobError('Job changed meanwhile; try again', 409);
  await announce(job, job.partnerId!, 'updated');
  return job;
}

/** Hashes a customer-choice token for storage (the raw token only goes in the email). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
