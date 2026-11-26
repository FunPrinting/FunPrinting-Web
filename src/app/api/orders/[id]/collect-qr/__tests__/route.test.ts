import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  requireUser: vi.fn(),
  orderFindOne: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
  orderFindById: vi.fn(),
  syncJobFromOrderStatus: vi.fn(async () => undefined),
  ensureOrderConversation: vi.fn(async () => ({ conversationId: 'chat_1' })),
  appendChatMessage: vi.fn(async () => ({})),
}));

vi.mock('@/lib/mongodb', () => ({ default: mocks.connectDB }));
vi.mock('@/lib/authz', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/jobs/service', () => ({ syncJobFromOrderStatus: mocks.syncJobFromOrderStatus }));
vi.mock('@/lib/chat/service', () => ({
  ensureOrderConversation: mocks.ensureOrderConversation,
  appendChatMessage: mocks.appendChatMessage,
}));
vi.mock('@/models/Order', () => ({
  default: {
    findOne: mocks.orderFindOne,
    findOneAndUpdate: mocks.orderFindOneAndUpdate,
    findById: mocks.orderFindById,
  },
}));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (fn: () => unknown) => { void fn(); } };
});

import { POST } from '@/app/api/orders/[id]/collect-qr/route';

describe('POST /api/orders/[id]/collect-qr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'u1', email: 'owner@example.com' });
  });

  it('propagates 401 when unauthenticated', async () => {
    mocks.requireUser.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(new NextRequest('http://localhost/api/orders/ORD1/collect-qr', { method: 'POST' }), {
      params: Promise.resolve({ id: 'ORD1' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a different signed-in user with 403', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({
        _id: 'o1',
        orderId: 'ORD1',
        customerInfo: { email: 'other@example.com' },
        deliveryOption: { type: 'pickup' },
        status: 'ready_for_pickup',
      }),
    });
    const res = await POST(new NextRequest('http://localhost/api/orders/ORD1/collect-qr', { method: 'POST' }), {
      params: Promise.resolve({ id: 'ORD1' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects unprinted orders with 409', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({
        _id: 'o1',
        orderId: 'ORD1',
        customerInfo: { email: 'owner@example.com' },
        deliveryOption: { type: 'pickup' },
        status: 'pending_cod_approval',
        paymentMethod: 'cod',
      }),
    });
    const res = await POST(new NextRequest('http://localhost/api/orders/ORD1/collect-qr', { method: 'POST' }), {
      params: Promise.resolve({ id: 'ORD1' }),
    });
    expect(res.status).toBe(409);
  });

  it('marks ready COD order collected, settles cash, and logs chat message for verified owner', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({
        _id: 'o1',
        orderId: 'ORD1',
        customerInfo: { email: 'owner@example.com', name: 'Asha' },
        deliveryOption: { type: 'pickup' },
        status: 'ready_for_pickup',
        paymentMethod: 'cod',
        paymentStatus: 'cod_pending',
        amount: 95,
      }),
    });
    mocks.orderFindOneAndUpdate.mockReturnValue({
      lean: async () => ({
        _id: 'o1',
        orderId: 'ORD1',
        status: 'completed',
        paymentStatus: 'completed',
        amount: 95,
        customerInfo: { name: 'Asha' },
      }),
    });

    const res = await POST(new NextRequest('http://localhost/api/orders/ORD1/collect-qr', { method: 'POST' }), {
      params: Promise.resolve({ id: 'ORD1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const [, update] = mocks.orderFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: 'completed',
      paymentStatus: 'completed',
      amountPaid: 95,
      'cod.qrVerifiedByEmail': 'owner@example.com',
      'cod.cashCollectedBy': 'customer_qr_verified',
    });
  });
});

