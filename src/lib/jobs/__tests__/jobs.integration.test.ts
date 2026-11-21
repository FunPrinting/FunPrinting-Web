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
const money = vi.hoisted(() => ({ refunds: [] as any[], released: [] as string[], failNext: false }));
vi.mock('@/lib/payments/refunds', () => ({
  requestRefund: vi.fn(async (ref: string, opts: any) => {
    if (money.failNext) { money.failNext = false; return null; }
    money.refunds.push({ ref, ...opts });
    return `rfnd_${money.refunds.length}`;
  }),
  releasePartnerTransfer: vi.fn(async (ref: string) => { money.released.push(ref); return 'released'; }),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
const partnerAuth = vi.hoisted(() => ({ id: '', deviceId: undefined as string | undefined }));
vi.mock('@/lib/authz', () => ({
  resolvePartnerRequest: vi.fn(async () => ({ partner: { _id: partnerAuth.id }, userId: 'u', deviceId: partnerAuth.deviceId })),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
const conv = vi.hoisted(() => ({ fail: false, calls: [] as string[] }));
vi.mock('@/lib/documents/fileUrls', () => ({
  fetchTrustedFile: vi.fn(async (url: string) => ({ buffer: Buffer.from(url), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
}));
vi.mock('@/lib/uploads/printReady', () => ({
  toPrintReady: vi.fn(async (_b: Buffer, mime: string) => {
    conv.calls.push(mime);
    if (conv.fail) throw new Error('converter down');
    return { pdf: Buffer.from('%PDF-'), pages: 4, passthrough: false };
  }),
}));
vi.mock('@/lib/storage', () => ({ uploadFile: vi.fn(async () => 'https://res.cloudinary.com/demo/print-ready/x.pdf') }));

import { acceptJob, claimJob, createJobForOrder, rejectJob, reportJob, syncJobFromOrderStatus, CLAIM_LEASE_MS } from '@/lib/jobs/service';
import { answerCustomerChoice, cancelJob, cancelJobAfterRefund, handleAcceptDeadline, sweepDeadlines } from '@/lib/jobs/deadlines';
import { resendJob } from '@/lib/jobs/service';
import PrintJob from '@/models/PrintJob';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import PartnerDevice from '@/models/PartnerDevice';

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
  money.refunds.length = 0; money.released.length = 0; money.failNext = false;
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

  it('shop deactivated since checkout (fresh order): customer refunded straight away', async () => {
    const orderId = await paidOrder(autoShop);
    await Partner.updateOne({ _id: autoShop }, { isActive: false });
    await createJobForOrder(orderId);
    expect((await jobOf(orderId)).status).toBe('cancelled');
    expect(money.refunds).toHaveLength(1);
    expect((await orderOf(orderId)).status).toBe('cancelled');
  });
});

describe('print-ready files', () => {
  it('PDF files of older orders are print-ready as they are; uploads carry their printUrl', async () => {
    const orderId = await paidOrder(autoShop, { printURLs: [null, 'https://res.cloudinary.com/demo/print-ready/b.pdf'] });
    const job = await createJobForOrder(orderId);
    expect(job.files.map((f) => f.printUrl)).toEqual(['https://f/a.pdf', 'https://res.cloudinary.com/demo/print-ready/b.pdf']);
    expect(conv.calls).toHaveLength(0);
  });

  it('a Word file from an older order is converted after the job is created', async () => {
    conv.calls.length = 0; conv.fail = false;
    const orderId = await paidOrder(autoShop, { fileURLs: ['https://f/cv.docx'], fileURL: 'https://f/cv.docx', originalFileNames: ['cv.docx'], fileTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
    await createJobForOrder(orderId);
    const job = await jobOf(orderId);
    expect(job.files[0]).toMatchObject({ printUrl: 'https://res.cloudinary.com/demo/print-ready/x.pdf', pages: 4 });
    expect(await claimJob({ partnerId: autoShop, deviceId: 'desk-0001' })).toMatchObject({ orderId });
  });

  it('a job whose files are not ready cannot be claimed until the sweep prepares them', async () => {
    conv.calls.length = 0; conv.fail = true;
    const orderId = await paidOrder(autoShop, { fileURLs: ['https://f/photo.png'], fileURL: 'https://f/photo.png', originalFileNames: ['photo.png'], fileTypes: ['image/png'] });
    await createJobForOrder(orderId);
    const device = { partnerId: autoShop, deviceId: 'desk-0001' };
    expect(await claimJob(device)).toBeNull();
    const { publicJob } = await import('@/lib/jobs/http');
    expect(publicJob(await jobOf(orderId)).printReady).toBe(false);

    conv.fail = false;
    const { prepareWaitingJobs } = await import('@/lib/jobs/printReady');
    await prepareWaitingJobs(autoShop);
    expect(await claimJob(device)).toMatchObject({ orderId });
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

  it('records which device and printer printed the job', async () => {
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    const { jobId } = await jobOf(orderId);
    await PartnerDevice.create({ deviceId: 'dev-front', partnerId: autoShop, userId: 'u', name: 'Front desk PC', platform: 'desktop', refreshTokenHash: 'h', refreshExpiresAt: new Date(Date.now() + 1e9), lastSeenAt: new Date() });
    const device = { partnerId: autoShop, deviceId: 'dev-front' };
    await claimJob(device, jobId);
    await reportJob(jobId, device, 'printing', undefined, 'HP LaserJet');
    expect((await jobOf(orderId)).claim.printer).toBe('HP LaserJet');
    await reportJob(jobId, device, 'printed');
    const job = await jobOf(orderId);
    expect(job.printedBy).toEqual({ deviceId: 'dev-front', deviceName: 'Front desk PC', printer: 'HP LaserJet' });
    expect(job.history.at(-1).detail).toBe('Front desk PC on HP LaserJet');
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

describe('review fixes', () => {
  it('an order already printing (by hand or the old app) gets a job with no deadlines and no refund', async () => {
    const orderId = await paidOrder(autoShop, { status: 'printing', orderStatus: 'printing' });
    const job = await createJobForOrder(orderId);
    expect(job).toMatchObject({ status: 'printing' });
    expect(job.acceptBy).toBeUndefined();
    expect(job.refundBy).toBeUndefined();
    expect(ws.notified).toEqual([]);
    expect(await sweepDeadlines()).toMatchObject({ refund: 0 });
  });

  it('a payment older than the refund window gets no deadlines (never refunded on creation)', async () => {
    const orderId = await paidOrder(manualShop, { paidAt: new Date(Date.now() - 3 * 24 * 3600_000) });
    const job = await createJobForOrder(orderId);
    expect(job).toMatchObject({ status: 'pending_acceptance' });
    expect(job.refundBy).toBeUndefined();
    expect(job.acceptBy).toBeUndefined();
    expect(money.refunds).toHaveLength(0);
  });

  it('old order whose shop is inactive: flagged for an admin, not refunded', async () => {
    const orderId = await paidOrder(autoShop, { paidAt: new Date(Date.now() - 3 * 24 * 3600_000) });
    await Partner.updateOne({ _id: autoShop }, { isActive: false });
    const job = await createJobForOrder(orderId, { legacy: true });
    expect(job.needsAttention).toMatch(/not active/);
    expect(money.refunds).toHaveLength(0);
  });

  it('admin resend refuses to reprint a printed or in-progress job without force', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    const d = { partnerId: autoShop, deviceId: 'dev-rsnd1' };
    await claimJob(d, jobId);
    await expect(resendJob(orderId, 'admin@x.com')).rejects.toThrow(/print it again/);
    await reportJob(jobId, d, 'printed');
    await expect(resendJob(orderId, 'admin@x.com')).rejects.toThrow(/print it again/);
    expect((await resendJob(orderId, 'admin@x.com', true)).status).toBe('queued');
  });

  it('resend for an old order that was already printed records it instead of printing again', async () => {
    const orderId = await paidOrder(autoShop, { status: 'printed', orderStatus: 'printed' });
    await expect(resendJob(orderId, 'admin@x.com')).rejects.toThrow(/use force/);
    expect((await jobOf(orderId)).status).toBe('printed');
  });

  it('shop accepting at the same moment as a customer refund: the accept wins, no refund', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    // Customer's refund check passed, then the shop accepts before the cancel update
    await PrintJob.updateOne({ jobId }, { $set: { acceptedAt: new Date(), status: 'queued' } });
    await expect(cancelJob(orderId, { reason: 'x', actor: 'customer', refund: true, untakenOnly: true })).rejects.toThrow(/just taken/);
    expect(money.refunds).toHaveLength(0);
    expect((await jobOf(orderId)).status).toBe('queued');
  });

  it('refund refused when the shop moved the order to printing from its order list', async () => {
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    await Order.updateOne({ orderId }, { $set: { status: 'printing' } }); // job sync not run yet
    await expect(cancelJob(orderId, { reason: 'x', actor: 'system', refund: true, untakenOnly: true })).rejects.toThrow(/already printing/);
    expect(money.refunds).toHaveLength(0);
  });

  it('a failed refund still cancels and reports refundPending (reconcile retries)', async () => {
    const orderId = await paidOrder(manualShop);
    await createJobForOrder(orderId);
    money.failNext = true;
    const r = await cancelJob(orderId, { reason: 'x', actor: 'admin:a', refund: true });
    expect(r).toMatchObject({ cancelled: true, refundPending: true });
  });

  it('a payment refunded elsewhere stops the job', async () => {
    const orderId = await paidOrder(autoShop);
    await createJobForOrder(orderId);
    await cancelJobAfterRefund(orderId);
    expect((await jobOf(orderId)).status).toBe('cancelled');
    expect(ws.cancelled).toEqual([orderId]);
  });

  it('a job printing on a device whose lease ran out is not handed to another device, and is flagged', async () => {
    const orderId = await paidOrder(autoShop);
    const { jobId } = await createJobForOrder(orderId);
    const d = { partnerId: autoShop, deviceId: 'dev-prt01' };
    await claimJob(d, jobId);
    await reportJob(jobId, d, 'printing');
    await PrintJob.updateOne({ jobId }, { $set: { 'claim.leaseUntil': new Date(Date.now() - 1000) } });
    expect(await claimJob({ partnerId: autoShop, deviceId: 'dev-prt02' }, jobId).catch((e) => e.status)).toBe(409);
    expect(await sweepDeadlines()).toMatchObject({ stuck: 1 });
    expect((await jobOf(orderId)).needsAttention).toMatch(/No "printed" report/);
  });

  it('accepting clears the customer banner', async () => {
    const orderId = await paidOrder(manualShop);
    const { jobId } = await createJobForOrder(orderId);
    await PrintJob.updateOne({ jobId }, { $set: { acceptBy: new Date(Date.now() - 1000) } });
    await handleAcceptDeadline(jobId);
    expect((await orderOf(orderId)).shopDelayNotifiedAt).toBeInstanceOf(Date);
    await acceptJob(jobId, { partnerId: manualShop });
    expect((await orderOf(orderId)).shopDelayNotifiedAt).toBeUndefined();
  });
});

describe('installed desktop app (GET /api/partner/orders)', () => {
  it('its fetch claims queued jobs and hides orders waiting for acceptance', async () => {
    const { GET } = await import('@/app/api/partner/orders/route');
    const { NextRequest } = await import('next/server');
    const queuedOrder = await paidOrder(autoShop);
    await createJobForOrder(queuedOrder);
    partnerAuth.id = autoShop;
    const req = new NextRequest('http://x/api/partner/orders', { headers: { authorization: 'Bearer t', 'user-agent': 'FunPrinting Electron/44' } });
    const body = await (await GET(req)).json();
    expect(body.orders.map((o: any) => o.orderId)).toContain(queuedOrder);
    expect((await jobOf(queuedOrder))).toMatchObject({ status: 'claimed', claim: { deviceId: 'legacy-pull' } });
    expect((await jobOf(queuedOrder)).refundBy).toBeUndefined();

    const manualOrder = await paidOrder(manualShop);
    await createJobForOrder(manualOrder);
    partnerAuth.id = manualShop;
    const body2 = await (await GET(req)).json();
    expect(body2.orders.map((o: any) => o.orderId)).not.toContain(manualOrder);
    // The web dashboard (session, no bearer) sees it, with its job
    const web = await (await GET(new NextRequest('http://x/api/partner/orders'))).json();
    expect(web.orders.find((o: any) => o.orderId === manualOrder).job.status).toBe('pending_acceptance');
  });

  it('a desktop app with device sign-in does not claim by fetching, and sees orders to accept', async () => {
    const { GET } = await import('@/app/api/partner/orders/route');
    const { NextRequest } = await import('next/server');
    const queuedOrder = await paidOrder(autoShop);
    await createJobForOrder(queuedOrder);
    partnerAuth.id = autoShop;
    partnerAuth.deviceId = 'dev_new_app';
    try {
      const req = new NextRequest('http://x/api/partner/orders', { headers: { authorization: 'Bearer t', 'user-agent': 'FunPrinting Electron/44' } });
      await GET(req);
      expect((await jobOf(queuedOrder)).status).toBe('queued');

      const manualOrder = await paidOrder(manualShop);
      await createJobForOrder(manualOrder);
      partnerAuth.id = manualShop;
      const body = await (await GET(req)).json();
      expect(body.orders.find((o: any) => o.orderId === manualOrder).job.status).toBe('pending_acceptance');
    } finally {
      partnerAuth.deviceId = undefined;
    }
  });
});
