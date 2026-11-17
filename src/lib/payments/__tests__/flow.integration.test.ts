import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks --------------------------------------------------------------------
const rz = vi.hoisted(() => ({
  links: new Map<string, any>(),
  created: [] as any[],
  refunds: [] as any[],
  released: [] as string[],
  seq: 0,
}));
vi.mock('@/lib/payments/razorpayApi', () => ({
  createPaymentLink: vi.fn(async (input: any) => {
    const id = `plink_${++rz.seq}`;
    const link = { id, short_url: `https://rzp.io/i/${id}`, status: 'created', amount: input.amount, amount_paid: 0, reference_id: input.referenceId, payments: null };
    rz.links.set(id, link);
    rz.created.push(input);
    return link;
  }),
  fetchPaymentLink: vi.fn(async (id: string) => rz.links.get(id)),
  cancelPaymentLink: vi.fn(async (id: string) => ({ ...rz.links.get(id), status: 'cancelled' })),
  refundPayment: vi.fn(async (paymentId: string, amount: number, opts: any) => {
    const r = { id: `rfnd_${++rz.seq}`, amount, status: 'pending', paymentId, opts };
    rz.refunds.push(r);
    return r;
  }),
  fetchPaymentTransfers: vi.fn(async () => [{ id: 'trf_1', recipient: 'acc_ABCDEFGHIJKLMN', amount: 0 }]),
  releaseTransfer: vi.fn(async (id: string) => { rz.released.push(id); return { id }; }),
}));
const side = vi.hoisted(() => ({ dispatched: [] as string[], invoices: [] as string[], adminNotices: 0, invoiceFails: 0 }));
vi.mock('@/lib/wssClient', () => ({ dispatchPrintJob: vi.fn(async (_p: string, o: any) => { side.dispatched.push(o.orderId); return { ok: true, delivered: 1 }; }) }));
vi.mock('@/lib/invoiceEmail', () => ({
  sendInvoiceEmail: vi.fn(async (o: any) => {
    if (side.invoiceFails > 0) { side.invoiceFails -= 1; return false; }
    side.invoices.push(o.orderId);
    return true;
  }),
}));
vi.mock('@/lib/notificationService', () => ({ sendPaymentNotification: vi.fn(async () => { side.adminNotices += 1; return true; }) }));
vi.mock('@/lib/printerClient', () => ({
  generateDeliveryNumber: () => 'A202611171',
  sendPrintJobFromOrder: vi.fn(async (o: any) => { side.dispatched.push(o.orderId); return { success: true }; }),
}));
const afterQueue = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => afterQueue.push(fn) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { createPrintCheckout } from '@/lib/payments/checkout';
import { createTemplateCheckout } from '@/lib/payments/templateCheckout';
import { runFulfilment, settlePaid } from '@/lib/payments/fulfil';
import { reconcilePayments, syncPaymentFromRazorpay } from '@/lib/payments/reconcile';
import { releasePartnerTransfer, startRefund } from '@/lib/payments/refunds';
import { signUploadReceipt } from '@/lib/uploads/receipt';
import { paymentLinkCallbackPayload, signForTests } from '@/lib/payments/signatures';
import { GET as callback } from '@/app/api/payments/callback/route';
import { POST as webhook } from '@/app/api/payments/webhook/route';
import Payment from '@/models/Payment';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import Pricing from '@/models/Pricing';
import CreatorEarning from '@/models/CreatorEarning';
import DynamicTemplate from '@/models/DynamicTemplate';
import User from '@/models/User';

const KEY_SECRET = 'rzp_secret_test';
const WEBHOOK_SECRET = 'whsec_test';
const user = { id: '64b7f0c2a1e4d5f6a7b8c9d0', email: 'buyer@example.com', role: 'customer', name: 'Buyer' };
let mongo: MongoMemoryServer;

async function drainAfter() {
  while (afterQueue.length) await afterQueue.shift()!();
}

function receipt(pages = 10, uid = user.email) {
  return signUploadReceipt({ url: `https://res.cloudinary.com/demo/${pages}.pdf`, name: `doc${pages}.pdf`, mime: 'application/pdf', size: 1000, pages, estimated: false, uid });
}

function checkoutInput(over: Record<string, unknown> = {}) {
  return {
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    customerInfo: { name: 'Buyer', phone: '9876543210', email: user.email },
    files: [{ receipt: receipt(10), pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 }],
    delivery: { type: 'pickup' },
    ...over,
  } as any;
}

function payLink(linkId: string, paymentId = `pay_${linkId}`) {
  const link = rz.links.get(linkId);
  link.status = 'paid';
  link.amount_paid = link.amount;
  link.payments = [{ payment_id: paymentId, amount: link.amount, status: 'captured', method: 'upi' }];
  return { link, paymentId };
}

function webhookRequest(body: object, eventId = `evt_${Math.random()}`) {
  const raw = JSON.stringify(body);
  return new NextRequest('http://localhost/api/payments/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'x-razorpay-signature': signForTests(WEBHOOK_SECRET, raw), 'x-razorpay-event-id': eventId, 'content-type': 'application/json' },
  });
}

function paidEvent(linkId: string, paymentId: string) {
  const link = rz.links.get(linkId);
  return {
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: linkId, reference_id: link.reference_id, status: 'paid', amount_paid: link.amount_paid } },
      payment: { entity: { id: paymentId, amount: link.amount_paid, status: 'captured', method: 'upi' } },
    },
  };
}

function callbackRequest(linkId: string, paymentId: string, opts: { tamper?: boolean } = {}) {
  const link = rz.links.get(linkId);
  const p = { paymentLinkId: linkId, referenceId: link.reference_id, status: 'paid', paymentId };
  const sig = signForTests(KEY_SECRET, paymentLinkCallbackPayload(p));
  const url = new URL('http://localhost/api/payments/callback');
  url.searchParams.set('razorpay_payment_id', paymentId);
  url.searchParams.set('razorpay_payment_link_id', linkId);
  url.searchParams.set('razorpay_payment_link_reference_id', opts.tamper ? 'SOMEONE_ELSE_1' : link.reference_id);
  url.searchParams.set('razorpay_payment_link_status', 'paid');
  url.searchParams.set('razorpay_signature', sig);
  return new NextRequest(url);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('payments');
  process.env.NEXTAUTH_SECRET = 'x'.repeat(32);
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.LOG_LEVEL = 'silent';
  const { default: connectDB } = await import('@/lib/mongodb');
  await connectDB();
  await Promise.all([Payment.init(), Order.init(), (await import('@/models/WebhookEvent')).default.init()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  }
  rz.links.clear();
  rz.created.length = 0;
  rz.refunds.length = 0;
  rz.released.length = 0;
  side.dispatched.length = 0;
  side.invoices.length = 0;
  side.adminNotices = 0;
  side.invoiceFails = 0;
  afterQueue.length = 0;
  delete process.env.RAZORPAY_ROUTE_ENABLED;
  // Pricing used when no partner is chosen
  await Pricing.create({
    basePrices: { A4: 5, A3: 10 },
    multipliers: { color: 2, doubleSided: 1.5 },
    deliveryCharges: { pickup: 0, delivery: { '0-5': 10, '5-10': 20, '10-15': 30, '15-20': 40, '20+': 50 } },
    additionalServices: { binding: 20, resumeTemplate: 0, minServiceFee: 5, minServiceFeePageLimit: 1 },
    updatedBy: 'test',
  }).catch(() => undefined);
});

describe('checkout', () => {
  it('prices from the receipt, creates a pending order, a Payment and a link for the total in paise', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://localhost');
    // 10 pages × ₹5 + ₹5 service = ₹55 → +3% = ₹56.65
    expect(r.amounts).toEqual({ subtotal: 5500, fee: 165, total: 5665 });
    expect(rz.created[0]).toMatchObject({ amount: 5665, referenceId: r.referenceId, callbackUrl: 'http://localhost/api/payments/callback' });
    expect(rz.created[0].expireBy * 1000 - Date.now()).toBeGreaterThan(15 * 60_000);
    const order = await Order.findOne({ orderId: r.orderId }).lean<any>();
    expect(order).toMatchObject({ status: 'pending_payment', paymentStatus: 'pending', amount: 55, paymentRef: r.referenceId, pricing: { total: 56.65 } });
  });

  it('is idempotent for the same key (double click)', async () => {
    const input = checkoutInput();
    const a = await createPrintCheckout(user, input, 'http://localhost');
    const b = await createPrintCheckout(user, input, 'http://localhost');
    expect(b.referenceId).toBe(a.referenceId);
    expect(rz.created).toHaveLength(1);
    expect(await Order.countDocuments()).toBe(1);
  });

  it('rejects receipts from another user or edited ones', async () => {
    await expect(createPrintCheckout(user, checkoutInput({ files: [{ receipt: receipt(10, 'other@example.com'), pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 }] }), 'http://x')).rejects.toThrow(/another user/);
    await expect(createPrintCheckout(user, checkoutInput({ files: [{ receipt: 'abc.def', pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 }] }), 'http://x')).rejects.toThrow(/receipt/);
  });

  it('uses partner pricing, requires an approved partner, and holds the Route share when enabled', async () => {
    const p = await Partner.create({ userId: 'u1', businessName: 'Shop', isActive: true, pricing: { perPageBW: 2, perPageColor: 10, binding: 30 }, razorpayAccountId: 'acc_ABCDEFGHIJKLMN', location: { type: 'Point', coordinates: [77, 28] } });
    process.env.RAZORPAY_ROUTE_ENABLED = '1';
    const r = await createPrintCheckout(user, checkoutInput({ delivery: { type: 'pickup', partnerId: String(p._id) } }), 'http://x');
    expect(r.amounts.subtotal).toBe(2000);
    expect(rz.created[0].transfers).toEqual([expect.objectContaining({ account: 'acc_ABCDEFGHIJKLMN', amount: 1800, on_hold: true })]);

    await Partner.updateOne({ _id: p._id }, { isActive: false });
    await expect(createPrintCheckout(user, checkoutInput({ delivery: { type: 'pickup', partnerId: String(p._id) } }), 'http://x')).rejects.toThrow(/not available/);
  });

  it('computes the delivery charge on the server', async () => {
    const r = await createPrintCheckout(
      user,
      checkoutInput({ delivery: { type: 'delivery', speed: 'express', recipientName: 'B', recipientPhone: '9876543210', address: 'X', city: 'C', state: 'S', pinCode: '110001' } }),
      'http://x'
    );
    // estimated: 0.06 kg → 1 slab ₹26, express ₹39
    expect(r.amounts.subtotal).toBe(5500 + 3900);
  });
});

describe('settlement', () => {
  it('webhook settles and fulfils once; a duplicate delivery is skipped', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);

    const res1 = await webhook(webhookRequest(paidEvent(linkId, paymentId), 'evt_same'));
    expect(res1.status).toBe(200);
    await drainAfter();
    const res2 = await webhook(webhookRequest(paidEvent(linkId, paymentId), 'evt_same'));
    expect(await res2.json()).toEqual({ status: 'duplicate' });

    const order = await Order.findOne({ orderId: r.orderId }).lean<any>();
    expect(order).toMatchObject({ paymentStatus: 'completed', status: 'printing', razorpayPaymentId: paymentId, amountPaid: 56.65 });
    expect(side.dispatched).toEqual([r.orderId]);
    expect(side.invoices).toEqual([r.orderId]);
    expect(side.adminNotices).toBe(1);
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p.fulfilment.completedAt).toBeInstanceOf(Date);
  });

  it('callback first, then webhook with a new event id: still fulfilled once', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);

    const res = await callback(callbackRequest(linkId, paymentId));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain(`/payment/status/${r.referenceId}`);
    await drainAfter();
    await webhook(webhookRequest(paidEvent(linkId, paymentId), 'evt_other'));
    await drainAfter();

    expect(side.dispatched).toHaveLength(1);
    expect(side.invoices).toHaveLength(1);
  });

  it('tampered callback is not trusted', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);
    const res = await callback(callbackRequest(linkId, paymentId, { tamper: true }));
    expect(res.headers.get('location')).toContain('notice=unverified');
    expect((await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).status).toBe('created');
  });

  it('webhook with a bad signature is rejected', async () => {
    const req = new NextRequest('http://localhost/api/payments/webhook', { method: 'POST', body: '{"event":"payment_link.paid"}', headers: { 'x-razorpay-signature': 'bad' } });
    expect((await webhook(req)).status).toBe(400);
  });

  it('flags a paid amount that differs from the charge', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    await settlePaid({ referenceId: r.referenceId, razorpayPaymentId: 'pay_x', amountPaid: p.amounts.total - 100, source: 'webhook' });
    expect((await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).needsReview).toMatch(/differs/);
  });

  it('a second, different payment for the same record is flagged, not applied', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    await settlePaid({ referenceId: r.referenceId, razorpayPaymentId: 'pay_1', amountPaid: p.amounts.total, source: 'webhook' });
    const second = await settlePaid({ referenceId: r.referenceId, razorpayPaymentId: 'pay_2', amountPaid: p.amounts.total, source: 'webhook' });
    expect(second.outcome).toBe('conflict');
    expect((await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentId).toBe('pay_1');
  });

  it('expired webhook closes the link but keeps the order payable; a late payment still settles', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    await webhook(webhookRequest({ event: 'payment_link.expired', payload: { payment_link: { entity: { id: linkId, status: 'expired' } } } }));
    expect((await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).status).toBe('expired');
    expect((await Order.findOne({ orderId: r.orderId }).lean<any>()).status).toBe('pending_payment');

    const { paymentId } = payLink(linkId);
    await webhook(webhookRequest(paidEvent(linkId, paymentId)));
    await drainAfter();
    expect((await Order.findOne({ orderId: r.orderId }).lean<any>()).paymentStatus).toBe('completed');
  });
});

describe('reconcile, retries and refunds', () => {
  it('reconcile settles a link the webhook missed and retries a failed invoice', async () => {
    side.invoiceFails = 1;
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    payLink(linkId);

    expect(await syncPaymentFromRazorpay(r.referenceId, 'reconcile')).toBe('paid');
    let p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p.fulfilment.invoice).toBeUndefined();
    expect(p.fulfilment.lastError).toMatch(/invoice/);

    await Payment.updateOne({ referenceId: r.referenceId }, { $set: { paidAt: new Date(Date.now() - 5 * 60_000) } });
    const report = await reconcilePayments();
    expect(report.fulfilmentRetried).toBe(1);
    p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p.fulfilment.completedAt).toBeInstanceOf(Date);
    expect(side.invoices).toEqual([r.orderId]);
    expect(side.dispatched).toHaveLength(1); // dispatch was not repeated
  });

  it('reconcile cancels orders left unpaid for 24 hours', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    await Order.collection.updateOne({ orderId: r.orderId }, { $set: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const report = await reconcilePayments();
    expect(report.ordersCancelled).toBe(1);
    expect((await Order.findOne({ orderId: r.orderId }).lean<any>()).status).toBe('cancelled');
  });

  it('refund starts with Razorpay; refund.processed marks the order refunded (once)', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'reconcile');

    const { refundId, amount } = await startRefund(r.referenceId, { reason: 'Shop closed', actor: 'admin@example.com' });
    expect(amount).toBe(5665);
    const evt = { event: 'refund.processed', payload: { refund: { entity: { id: refundId, payment_id: paymentId, amount } } } };
    await webhook(webhookRequest(evt));
    await webhook(webhookRequest(evt)); // different event id, same refund
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p).toMatchObject({ status: 'refunded', amountRefunded: 5665 });
    expect((await Order.findOne({ orderId: r.orderId }).lean<any>())).toMatchObject({ paymentStatus: 'refunded', status: 'refunded' });
    await expect(startRefund(r.referenceId, { reason: 'again', actor: 'a' })).rejects.toThrow(/refunded/);
  });

  it('releases the held partner transfer once', async () => {
    const partner = await Partner.create({ userId: 'u2', businessName: 'Shop', isActive: true, razorpayAccountId: 'acc_ABCDEFGHIJKLMN', location: { type: 'Point', coordinates: [77, 28] } });
    process.env.RAZORPAY_ROUTE_ENABLED = '1';
    const r = await createPrintCheckout(user, checkoutInput({ delivery: { type: 'pickup', partnerId: String(partner._id) } }), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'reconcile');
    expect(await releasePartnerTransfer(r.referenceId)).toBe('released');
    expect(await releasePartnerTransfer(r.referenceId)).toBe('already');
    expect(rz.released).toEqual(['trf_1']);
  });

  it('legacy Standard Checkout capture is settled through the same fulfilment', async () => {
    await new Order({
      customerInfo: { name: 'Old', phone: '9876543210', email: 'old@example.com' },
      orderType: 'file',
      fileURL: 'https://f/a.pdf',
      printingOptions: { pageSize: 'A4', color: 'bw', sided: 'single', copies: 1, pageCount: 2 },
      deliveryOption: { type: 'pickup' },
      amount: 20,
      razorpayOrderId: 'order_LEGACY1',
      status: 'pending_payment',
    }).save();
    const evt = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_legacy', amount: 2060, status: 'captured', order_id: 'order_LEGACY1' } } } };
    await webhook(webhookRequest(evt));
    await drainAfter();
    const order = await Order.findOne({ razorpayOrderId: 'order_LEGACY1' }).lean<any>();
    expect(order).toMatchObject({ paymentStatus: 'completed', razorpayPaymentId: 'pay_legacy' });
    // The same capture again does nothing
    await webhook(webhookRequest(evt));
    await drainAfter();
    expect(side.invoices).toHaveLength(1);
  });
});

describe('review fixes', () => {
  async function paidCheckout() {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);
    const settled = await settlePaid({ paymentLinkId: linkId, razorpayPaymentId: paymentId, amountPaid: rz.links.get(linkId).amount_paid, source: 'webhook' });
    expect(settled.outcome).toBe('paid');
    return { r, linkId, paymentId };
  }

  it('concurrent fulfilment runs dispatch and email exactly once', async () => {
    const { r } = await paidCheckout();
    const runs = await Promise.all([runFulfilment(r.referenceId), runFulfilment(r.referenceId), runFulfilment(r.referenceId), runFulfilment(r.referenceId)]);
    expect(runs.filter((x) => x.busy).length).toBeGreaterThanOrEqual(1);
    await runFulfilment(r.referenceId);
    expect(side.dispatched).toEqual([r.orderId]);
    expect(side.invoices).toEqual([r.orderId]);
    expect(side.adminNotices).toBe(1);
  });

  it('a second attempt paid for an already-paid order is flagged and never printed', async () => {
    const { r } = await paidCheckout();
    await runFulfilment(r.referenceId);
    // A second attempt for the same order (e.g. an old open link) gets paid too
    const second = await Payment.create({
      referenceId: `${r.orderId}_9`, purpose: 'print_order', status: 'created', userEmail: user.email, orderId: r.orderId,
      amounts: { subtotal: 5500, fee: 165, total: 5665 }, razorpay: {}, expiresAt: new Date(Date.now() + 60_000), fulfilment: { attempts: 0 }, events: [],
    });
    await settlePaid({ referenceId: second.referenceId, razorpayPaymentId: 'pay_second', amountPaid: 5665, source: 'webhook' });
    await runFulfilment(second.referenceId);
    expect(side.dispatched).toHaveLength(1);
    expect(side.invoices).toHaveLength(1);
    const p2 = await Payment.findOne({ referenceId: second.referenceId }).lean<any>();
    expect(p2.needsReview).toMatch(/needs a refund/);
    expect(p2.fulfilment.skipped).toBeTruthy();
  });

  it('paying the order closes its other open links', async () => {
    const r = await createPrintCheckout(user, checkoutInput(), 'http://x');
    const other = await Payment.create({
      referenceId: `${r.orderId}_8`, purpose: 'print_order', status: 'created', userEmail: user.email, orderId: r.orderId,
      amounts: { subtotal: 5500, fee: 165, total: 5665 }, razorpay: { paymentLinkId: 'plink_other' }, expiresAt: new Date(Date.now() + 600_000), fulfilment: { attempts: 0 }, events: [],
    });
    rz.links.set('plink_other', { id: 'plink_other', status: 'created', amount: 5665, amount_paid: 0, reference_id: other.referenceId });
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'webhook');
    expect((await Payment.findOne({ referenceId: other.referenceId }).lean<any>()).status).toBe('cancelled');
  });

  it('refund marks a template creator earning cancelled and blocks transfer release', async () => {
    await DynamicTemplate.collection.insertOne({ id: 'tplR', name: 'R', isPaid: true, price: 100, createdByType: 'user', createdByEmail: 'c2@example.com' });
    await User.collection.insertOne({ name: 'C2', email: 'c2@example.com', role: 'customer' });
    const r = await createTemplateCheckout(user, { idempotencyKey: 'refund-tpl-1', templateId: 'tplR', formData: {} }, 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    const { paymentId } = payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'reconcile');
    const { refundId, amount } = await startRefund(r.referenceId, { reason: 'test', actor: 'a' });
    // Two confirmations of the same refund arriving together are applied once
    const { applyRefundProcessed } = await import('@/lib/payments/refunds');
    await Promise.all([applyRefundProcessed({ id: refundId, payment_id: paymentId, amount }), applyRefundProcessed({ id: refundId, payment_id: paymentId, amount })]);
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p).toMatchObject({ status: 'refunded', amountRefunded: amount });
    expect((await CreatorEarning.findOne({ razorpayPaymentId: paymentId }).lean<any>()).status).toBe('cancelled');
    expect(await releasePartnerTransfer(r.referenceId)).toBe('none');
  });

  it('rejects receipts whose page count was only estimated', async () => {
    const est = signUploadReceipt({ url: 'https://res.cloudinary.com/demo/e.docx', name: 'e.docx', mime: 'application/msword', size: 1, pages: 2, estimated: true, uid: user.email });
    await expect(createPrintCheckout(user, checkoutInput({ files: [{ receipt: est, pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 }] }), 'http://x')).rejects.toThrow(/save it as a PDF/);
  });

  it('two simultaneous checkouts with one key create one order', async () => {
    const input = checkoutInput();
    const results = await Promise.allSettled([createPrintCheckout(user, input, 'http://x'), createPrintCheckout(user, input, 'http://x')]);
    expect(await Order.countDocuments()).toBe(1);
    const ok = results.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const x of results) if (x.status === 'rejected') expect(String(x.reason.message)).toMatch(/being prepared/);
  });

  it('paid template generation needs this user\'s paid purchase and uses its stored form data', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: user.email } } as never);
    const { checkTemplateAccess } = await import('@/lib/payments/templateAccess');
    await DynamicTemplate.collection.insertOne({ id: 'tplG', name: 'G', isPaid: true, price: 10 });
    expect((await checkTemplateAccess('tplG', { a: 1 }, undefined)) as any).toHaveProperty('status', 402);

    const r = await createTemplateCheckout(user, { idempotencyKey: 'gen-tpl-123', templateId: 'tplG', formData: { name: 'Stored' } }, 'http://x');
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'reconcile');
    const access = (await checkTemplateAccess('tplG', { name: 'Other' }, r.referenceId)) as any;
    expect(access).toMatchObject({ paid: true, formData: { name: 'Stored' } });
    for (let i = 0; i < 4; i++) await checkTemplateAccess('tplG', {}, r.referenceId);
    expect(((await checkTemplateAccess('tplG', {}, r.referenceId)) as any).status).toBe(402); // 5 used

    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'someone@else.com' } } as never);
    expect(((await checkTemplateAccess('tplG', {}, r.referenceId)) as any).status).toBe(402);
    await DynamicTemplate.collection.insertOne({ id: 'tplFree', name: 'F', isPaid: false });
    expect(await checkTemplateAccess('tplFree', { x: 1 }, undefined)).toEqual({ paid: false, formData: { x: 1 } });
  });
});

describe('template purchase', () => {
  it('prices from the template, stores form data and creates the creator earning once', async () => {
    const { insertedId } = await User.collection.insertOne({ name: 'C', email: 'creator@example.com', role: 'customer' });
    const creator = { _id: insertedId };
    await DynamicTemplate.collection.insertOne({ id: 'tpl1', name: 'Resume', isPaid: true, price: 49, createdByType: 'user', createdByEmail: 'creator@example.com' });

    const r = await createTemplateCheckout(user, { idempotencyKey: 'tplkey-123456', templateId: 'tpl1', formData: { name: 'Buyer' } }, 'http://x');
    expect(r.amounts).toEqual({ subtotal: 4900, fee: 147, total: 5047 });
    const linkId = (await Payment.findOne({ referenceId: r.referenceId }).lean<any>()).razorpay.paymentLinkId;
    payLink(linkId);
    await syncPaymentFromRazorpay(r.referenceId, 'reconcile');
    await runFulfilment(r.referenceId);

    const earnings = await CreatorEarning.find().lean<any[]>();
    expect(earnings).toHaveLength(1);
    // 20% commission → creator gets 80% of ₹49
    expect(earnings[0]).toMatchObject({ creatorUserId: expect.anything(), amount: 39.2, templateId: 'tpl1' });
    expect(String(earnings[0].creatorUserId)).toBe(String(creator!._id));
    const p = await Payment.findOne({ referenceId: r.referenceId }).lean<any>();
    expect(p.template.formData).toEqual({ name: 'Buyer' });
  });

  it('refuses free templates', async () => {
    await DynamicTemplate.collection.insertOne({ id: 'free1', name: 'Free', isPaid: false, price: 0 });
    await expect(createTemplateCheckout(user, { idempotencyKey: 'tplkey-free00', templateId: 'free1', formData: {} }, 'http://x')).rejects.toThrow(/free/);
  });
});
