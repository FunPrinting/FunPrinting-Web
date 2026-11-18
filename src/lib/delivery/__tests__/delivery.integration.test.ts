import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---------------------------------------------------------------------
const partnerAuth = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/authz', () => ({
  resolvePartnerRequest: vi.fn(async () => ({ partner: { _id: partnerAuth.id }, userId: 'u' })),
}));
vi.mock('@/lib/jobs/service', () => ({ syncJobFromOrderStatus: vi.fn(async () => undefined) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { distanceKm, getDeliveryOptions, pickupNickname } from '@/lib/delivery/options';
import { forPartner } from '@/lib/partnerOrderView';
import { GET as getOrder, PATCH as patchOrder } from '@/app/api/partner/orders/[orderId]/route';

let mongo: MongoMemoryServer;
let shopId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('delivery');
  process.env.LOG_LEVEL = 'silent';
  delete process.env.SHIPROCKET_EMAIL;
  delete process.env.SHIPROCKET_PASSWORD;
  const { default: connectDB } = await import('@/lib/mongodb');
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  const shop = await Partner.create({
    userId: 'owner',
    businessName: 'Shop',
    isActive: true,
    location: { type: 'Point', coordinates: [77, 28] },
    address: { street: 'Main Road, Shop 4', city: 'C', state: 'S', zipCode: '110002' },
  });
  shopId = String(shop._id);
  partnerAuth.id = shopId;
});

async function shopDeliveryOrder(status = 'printed') {
  const order = await new Order({
    customerInfo: { name: 'Buyer', phone: '+919876543210', email: 'buyer@example.com' },
    orderType: 'file',
    fileURL: 'https://f/a.pdf',
    printingOptions: { pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 },
    deliveryOption: { type: 'delivery', partnerId: shopId, method: 'shop', speed: 'shop', handover: { code: '4821', attempts: 0 } },
    partnerId: shopId,
    amount: 50,
    paymentStatus: 'completed',
    status,
    orderStatus: status,
  }).save();
  return order.orderId as string;
}

const patch = (orderId: string, body: Record<string, unknown>) =>
  patchOrder(new NextRequest(`http://x/api/partner/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ orderId }) });

describe('delivery options', () => {
  it('measures distance in km', () => {
    expect(distanceKm({ lat: 28, lng: 77 }, { lat: 28.01, lng: 77 })).toBeCloseTo(1.11, 1);
  });

  it('a shop with no delivery settings offers pickup only', async () => {
    const shop = await Partner.findById(shopId).lean<any>();
    expect(await getDeliveryOptions(shop, { pinCode: '110001', weightKg: 0.1, location: { lat: 28.01, lng: 77 } })).toMatchObject({
      courier: [],
      shop: null,
      shopUnavailable: 'not_offered',
      offersDelivery: false,
    });
  });

  it('shop delivery is offered only inside the radius', async () => {
    await Partner.updateOne({ _id: shopId }, { $set: { delivery: { self: { enabled: true, radiusKm: 2, fee: 25, etaMinutes: 60 } } } });
    const shop = await Partner.findById(shopId).lean<any>();
    const near = await getDeliveryOptions(shop, { weightKg: 0.1, location: { lat: 28.01, lng: 77 } });
    expect(near.shop).toMatchObject({ fee: 25, etaMinutes: 60, radiusKm: 2 });
    expect(near.offersDelivery).toBe(true);
    expect((await getDeliveryOptions(shop, { weightKg: 0.1, location: { lat: 28.05, lng: 77 } })).shopUnavailable).toBe('too_far');
    expect((await getDeliveryOptions(shop, { weightKg: 0.1 })).shopUnavailable).toBe('need_location');
  });

  it('pickup nicknames fit Shiprocket’s 36-character limit and change with the address', () => {
    const a = pickupNickname(shopId, { street: 'A', zipCode: '110002' });
    expect(a.length).toBeLessThanOrEqual(36);
    expect(pickupNickname(shopId, { street: 'B', zipCode: '110002' })).not.toBe(a);
  });
});

describe('shop delivery handover code', () => {
  it('is never shown to the shop', async () => {
    const orderId = await shopDeliveryOrder();
    const res = await getOrder(new NextRequest(`http://x/api/partner/orders/${orderId}`), { params: Promise.resolve({ orderId }) });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('4821');
    expect(body.order.deliveryOption.handover).toEqual({ required: true, verified: false, attemptsLeft: 5 });
    expect(forPartner({ deliveryOption: { type: 'pickup' } })).toEqual({ deliveryOption: { type: 'pickup' } });
  });

  it('out for delivery, then delivered only with the right code', async () => {
    const orderId = await shopDeliveryOrder();
    expect((await patch(orderId, { status: 'dispatched' })).status).toBe(200);

    const missing = await patch(orderId, { status: 'delivered' });
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe('handover_required');

    const wrong = await patch(orderId, { status: 'delivered', code: '1111' });
    expect(await wrong.json()).toMatchObject({ code: 'handover_wrong', attemptsLeft: 4 });

    const right = await patch(orderId, { status: 'delivered', code: '48 21' });
    expect(right.status).toBe(200);
    const body = await right.json();
    expect(JSON.stringify(body)).not.toContain('4821');
    const saved = await Order.findOne({ orderId }).lean<any>();
    expect(saved.status).toBe('delivered');
    expect(saved.deliveryOption.handover.verifiedAt).toBeInstanceOf(Date);
  });

  it('locks after five wrong codes', async () => {
    const orderId = await shopDeliveryOrder('dispatched');
    for (let i = 0; i < 5; i++) await patch(orderId, { status: 'delivered', code: '0000' });
    const locked = await patch(orderId, { status: 'delivered', code: '4821' });
    expect(locked.status).toBe(423);
    expect((await Order.findOne({ orderId }).lean<any>()).status).toBe('dispatched');
  });

  it('courier orders cannot be marked delivered by the shop', async () => {
    const order = await new Order({
      customerInfo: { name: 'Buyer', phone: '+919876543210', email: 'buyer@example.com' },
      orderType: 'file',
      printingOptions: { pageSize: 'A4', color: 'bw', sided: 'single', copies: 1 },
      deliveryOption: { type: 'delivery', partnerId: shopId, method: 'courier' },
      partnerId: shopId,
      amount: 50,
      paymentStatus: 'completed',
      status: 'printed',
      orderStatus: 'printed',
    }).save();
    const res = await patch(order.orderId, { status: 'delivered' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/book the courier/);
  });
});
