import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---------------------------------------------------------------------
const ws = vi.hoisted(() => ({ notified: [] as string[], pushed: [] as string[], cancelled: [] as string[], pushDelivered: 0 }));
vi.mock('@/lib/wssClient', () => ({
  notifyPartnerJobs: vi.fn(async (partnerId: string, reason: string) => { ws.notified.push(`${partnerId}:${reason}`); return { ok: true, delivered: 1 }; }),
  dispatchPrintJob: vi.fn(async (_p: string, o: any) => { ws.pushed.push(o.orderId); return { ok: true, delivered: ws.pushDelivered }; }),
  cancelPrintJob: vi.fn(async (_p: string, orderId: string) => { ws.cancelled.push(orderId); return { ok: true, delivered: 1 }; }),
}));
const mail = vi.hoisted(() => ({ delay: [] as any[], refunds: [] as any[] }));
vi.mock('@/lib/jobs/emails', () => ({
  sendShopDelayEmail: vi.fn(async (o: any) => { mail.delay.push(o); return true; }),
  sendRefundEmail: vi.fn(async (o: any) => { mail.refunds.push(o); return true; }),
}));
const money = vi.hoisted(() => ({ refunds: [] as any[], released: [] as string[] }));
vi.mock('@/lib/payments/refunds', () => ({
  startRefund: vi.fn(async (ref: string, opts: any) => { money.refunds.push({ ref, ...opts }); return { refundId: `rfnd_${money.refunds.length}`, amount: 100 }; }),
  releasePartnerTransfer: vi.fn(async (ref: string) => { money.released.push(ref); return 'released'; }),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { acceptJob, claimJob, createJobForOrder, rejectJob, reportJob, syncJobFromOrderStatus, CLAIM_LEASE_MS } from '@/lib/jobs/service';
import { answerCustomerChoice, cancelJob, handleAcceptDeadline, sweepDeadlines } from '@/lib/jobs/deadlines';
import PrintJob from '@/models/PrintJob';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

let mongo: MongoMemoryServer;
let autoShop = '';
let manualShop = '';
let seq = 0;

async function paidOrder(partnerId: string, over: Record<string, unknown> = {}) {
  const order = await new Order({
    customerInfo: { name: 'Buyer', phone: '9876543210', email: 'buyer@example.com' },
    orderType: 'file',
    fileURL: 'https://f/a.pdf',
    fileURLs: ['https://f/a.pdf', 'https://f/b.pdf'],
    originalFileNames: ['a.pdf', 'b.pdf'],
    printingOptions: { pageSize: 'A4', color: 'bw', sided: 'single', copies: 2, pageCount: 3, fileOptions: [{ pageSize: 'A4', color: 'bw', sided: 'single', copies: 2 }, { pageSize: 'A3', color: 'color', sided: 'double', copies: 1 }] },
    deliveryOption: { type: 'pickup', partnerId },
    partnerId,
    amount: 50,
    paymentStatus: 'completed',
    status: 'paid',
    orderStatus: 'pending',
    paymentRef: `REF${++seq}`,
    paidAt: new Date(),
    ...over,
  }).save();
  return order.orderId as string;
}

const jobOf = (orderId: string) => PrintJob.findOne({ orderId }).lean<any>();
const orderOf = (orderId: string) => Order.findOne({ orderId }).lean<any>();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('jobs');
  process.env.LOG_LEVEL = 'silent';
  const { default: connectDB } = await import('@/lib/mongodb');
  await connectDB();
  await Promise.all([PrintJob.init(), Order.init()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  ws.notified.length = 0; ws.pushed.length = 0; ws.cancelled.length = 0; ws.pushDelivered = 0;
  mail.delay.length = 0; mail.refunds.length = 0;
  money.refunds.length = 0; money.released.length = 0;
  vi.useRealTimers();
  autoShop = String((await Partner.create({ userId: 'a', businessName: 'Auto Shop', isActive: true, acceptanceMode: 'auto', location: { type: 'Point', coordinates: [77, 28] } }))._id);
  manualShop = String((await Partner.create({ userId: 'm', businessName: 'Manual Shop', isActive: true, acceptanceMode: 'manual', location: { type: 'Point', coordinates: [77, 28] } }))._id);
});

describe('creating jobs', () => {
  it('auto-accept shop: queued with every file, deadlines set, devices notified; one job per order', async () => {
    const orderId = await paidOrder(autoShop);
    const job = await createJobForOrder(orderId);
    expect(job).toMatchObject({ status: 'queued', partnerId: autoShop, acceptanceMode: 'auto' });
    expect(job.files.map((f) => [f.name, f.pageSize, f.copies])).toEqual([['a.pdf', 'A4', 2], ['b.pdf', 'A3', 1]]);
    expect(job.acceptBy!.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(job.refundBy!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(ws.notified).toEqual([`${autoShop}:new`]);
    expect((await orderOf(orderId)).deliveryNumber).toMatch(/^[A-Z]\d{8}[A-Z2-9]{4}$/);

    await createJobForOrder(orderId);
    expect(await PrintJob.countDocuments()).toBe(1);
  });

  it('installed desktop app still gets the push; receiving it counts as a claim', async () => {
    ws.pushDelivered = 1;
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    const job = await jobOf(orderId);
    expect(job).toMatchObject({ status: 'claimed', claim: { deviceId: 'legacy-push' } });
    expect(job.refundBy).toBeUndefined();
    expect((await orderOf(orderId)).status).toBe('printing');
  });

  it('manual shop: waits for acceptance and gets no push', async () => {
    ws.pushDelivered = 1;
    const orderId = await paidOrder(manualShop);
    const job = await createJobForOrder(orderId);
    expect(job.status).toBe('pending_acceptance');
    expect(ws.pushed).toEqual([]);
    const accepted = await acceptJob(job.jobId, { partnerId: manualShop });
    expect(accepted.status).toBe('queued');
    expect(accepted.acceptBy).toBeUndefined();
    expect(accepted.refundBy).toBeUndefined();
  });

  it('shop deactivated since checkout: customer refunded straight away', async () => {
    const orderId = await paidOrder(autoShop);
    await Partner.updateOne({ _id: autoShop }, { isActive: false });
    await createJobForOrder(orderId);
    expect((await jobOf(orderId)).status).toBe('cancelled');
    expect(money.refunds).toHaveLength(1);
    expect((await orderOf(orderId)).status).toBe('cancelled');
  });
});

describe('devices', () => {
  it('claim → printing → printed updates the order and releases the partner share', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    const device = { partnerId: autoShop, deviceId: 'desk-0001' };
    const claimed = await claimJob(device);
    expect(claimed).toMatchObject({ jobId, status: 'claimed' });
    expect((await orderOf(orderId)).status).toBe('processing');
    await reportJob(jobId, device, 'printing');
    expect((await orderOf(orderId)).status).toBe('printing');
    await reportJob(jobId, device, 'printed');
    expect(await orderOf(orderId)).toMatchObject({ status: 'printed', orderStatus: 'printed' });
    expect(money.released).toEqual([(await orderOf(orderId)).paymentRef]);
    expect(await claimJob(device)).toBeNull();
  });

  it('two devices racing: exactly one gets the job', async () => {
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    const results = await Promise.all(['dev-aaaa1', 'dev-bbbb2', 'dev-cccc3'].map((d) => claimJob({ partnerId: autoShop, deviceId: d })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a lease that runs out lets another device take over; the old device can no longer report', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    await claimJob({ partnerId: autoShop, deviceId: 'dev-old01' });
    expect(await claimJob({ partnerId: autoShop, deviceId: 'dev-new01' }, jobId).catch((e) => e.status)).toBe(409);
    await PrintJob.updateOne({ jobId }, { $set: { 'claim.leaseUntil': new Date(Date.now() - 1000) } });
    expect(await claimJob({ partnerId: autoShop, deviceId: 'dev-new01' }, jobId)).toMatchObject({ claim: { deviceId: 'dev-new01' } });
    await expect(reportJob(jobId, { partnerId: autoShop, deviceId: 'dev-old01' }, 'printed')).rejects.toThrow(/does not hold/);
  });

  it('failed print goes back to the queue; three failures flag it', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    const d = { partnerId: autoShop, deviceId: 'dev-fail1' };
    for (let i = 0; i < 3; i++) {
      await claimJob(d, jobId);
      await reportJob(jobId, d, 'failed', 'Paper jam');
    }
    const job = await jobOf(orderId);
    expect(job).toMatchObject({ status: 'failed', lastError: 'Paper jam' });
    expect(job.needsAttention).toMatch(/3 times/);
  });

  it('another shop cannot see or touch the job', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    await expect(claimJob({ partnerId: manualShop, deviceId: 'dev-other' }, jobId)).resolves.toBeNull();
    await expect(rejectJob(jobId, { partnerId: manualShop })).rejects.toThrow(/not found/);
  });
});

describe('late shops: never moved, customer decides, 24 h refund', () => {
  it('after 10 minutes the customer is emailed once; the order stays with the shop, which can still accept', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    await PrintJob.updateOne({ jobId }, { $set: { acceptBy: new Date(Date.now() - 1000) } });

    expect(await handleAcceptDeadline(jobId)).toBe('customer notified');
    expect(await handleAcceptDeadline(jobId)).toBe('already asked'); // not emailed twice
    expect(mail.delay).toHaveLength(1);
    expect(mail.delay[0]).toMatchObject({ orderId, shop: 'Manual Shop' });
    const job = await jobOf(orderId);
    expect(job).toMatchObject({ status: 'pending_acceptance', partnerId: manualShop });
    expect((await orderOf(orderId)).shopDelayNotifiedAt).toBeInstanceOf(Date);

    await acceptJob(jobId, { partnerId: manualShop });
    const token = new URL(mail.delay[0].choiceUrl).searchParams.get('token')!;
    await expect(answerCustomerChoice(orderId, { token }, 'refund')).rejects.toThrow(/already accepted/);
    expect(money.refunds).toHaveLength(0);
  });

  it('customer chooses refund now (email link or signed in)', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    await PrintJob.updateOne({ jobId }, { $set: { acceptBy: new Date(Date.now() - 1000) } });
    await handleAcceptDeadline(jobId);
    const token = new URL(mail.delay[0].choiceUrl).searchParams.get('token')!;
    await expect(answerCustomerChoice(orderId, { token: 'wrong-token-wrong-token' }, 'refund')).rejects.toThrow(/no longer valid/);
    expect(await answerCustomerChoice(orderId, { token }, 'refund')).toEqual({ result: 'refunded' });
    expect((await jobOf(orderId)).status).toBe('cancelled');
    expect(money.refunds).toHaveLength(1);
    expect(ws.cancelled).toEqual([orderId]);
  });

  it('customer keeps waiting; 24 h after payment it is refunded automatically', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    await PrintJob.updateOne({ jobId }, { $set: { acceptBy: new Date(Date.now() - 1000) } });
    await handleAcceptDeadline(jobId);
    expect(await answerCustomerChoice(orderId, { ownerVerified: true }, 'wait')).toEqual({ result: 'waiting' });
    expect((await jobOf(orderId)).status).toBe('pending_acceptance');

    await PrintJob.updateOne({ jobId }, { $set: { refundBy: new Date(Date.now() - 1000) } });
    expect(await sweepDeadlines()).toMatchObject({ refund: 1 });
    expect((await jobOf(orderId)).status).toBe('cancelled');
    expect(money.refunds[0].reason).toMatch(/24 hours/);
    expect(mail.refunds).toHaveLength(1);
  });

  it('shop declines: refunded straight away, never moved', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    await rejectJob(jobId, { partnerId: manualShop }, 'Printer broken');
    const job = await jobOf(orderId);
    expect(job).toMatchObject({ status: 'cancelled', partnerId: manualShop });
    expect(job.rejections[0]).toMatchObject({ partnerId: manualShop, reason: 'Printer broken' });
    expect(money.refunds).toHaveLength(1);
    expect((await orderOf(orderId)).deliveryOption.partnerId).toBe(manualShop);
  });

  it('a claimed job is never auto-refunded', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    await claimJob({ partnerId: autoShop, deviceId: 'dev-keep1' });
    await PrintJob.updateOne({ jobId }, { $set: { refundBy: new Date(Date.now() - 1000), acceptBy: new Date(Date.now() - 1000) } });
    expect(await sweepDeadlines()).toMatchObject({ accept: 0, refund: 0 });
    expect(money.refunds).toHaveLength(0);
  });
});

describe('cancellation and status sync', () => {
  it('customers cannot cancel once the shop started; admins can with force', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    await claimJob({ partnerId: autoShop, deviceId: 'dev-c0001' });
    await expect(cancelJob(orderId, { reason: 'x', actor: 'customer', refund: true })).rejects.toThrow(/started/);
    await cancelJob(orderId, { reason: 'Shop lost the file', actor: 'admin:a@b.c', refund: true, force: true });
    expect((await PrintJob.findOne({ jobId }).lean<any>()).status).toBe('cancelled');
    expect(money.refunds).toHaveLength(1);
  });

  it('order status set from the dashboard or old app keeps the job in step and releases payout', async () => {
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    await syncJobFromOrderStatus(orderId, 'printing', 'partner:x');
    expect((await jobOf(orderId)).status).toBe('printing');
    await syncJobFromOrderStatus(orderId, 'ready_for_pickup', 'partner:x');
    expect((await jobOf(orderId)).status).toBe('printed');
    expect(money.released).toHaveLength(1);
  });

  it('lease length is sensible', () => {
    expect(CLAIM_LEASE_MS).toBe(5 * 60_000);
  });
});
