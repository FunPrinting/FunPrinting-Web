import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  resolvePartnerRequest: vi.fn(),
  orderFindOne: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
  createJobForOrder: vi.fn(async () => ({ jobId: 'JORD1', status: 'queued' })),
  announce: vi.fn(async () => undefined),
  ensureOrderConversation: vi.fn(async () => ({ conversationId: 'chat_1' })),
  appendChatMessage: vi.fn(async () => ({})),
  convUpdateOne: vi.fn(async () => ({})),
  printJobFindOneAndUpdate: vi.fn(),
  userUpdateOne: vi.fn(async () => ({})),
}));

vi.mock('@/lib/mongodb', () => ({ default: mocks.connectDB }));
vi.mock('@/lib/authz', () => ({ resolvePartnerRequest: mocks.resolvePartnerRequest }));
vi.mock('@/lib/jobs/service', () => ({
  createJobForOrder: mocks.createJobForOrder,
  announce: mocks.announce,
}));
vi.mock('@/lib/chat/service', () => ({
  ensureOrderConversation: mocks.ensureOrderConversation,
  appendChatMessage: mocks.appendChatMessage,
}));
vi.mock('@/models/Order', () => ({
  default: { findOne: mocks.orderFindOne, findOneAndUpdate: mocks.orderFindOneAndUpdate },
}));
vi.mock('@/models/Conversation', () => ({ default: { updateOne: mocks.convUpdateOne } }));
vi.mock('@/models/PrintJob', () => ({ default: { findOneAndUpdate: mocks.printJobFindOneAndUpdate } }));
vi.mock('@/models/User', () => ({ default: { updateOne: mocks.userUpdateOne } }));

import { POST } from '@/app/api/partner/orders/[orderId]/cod/route';

describe('POST /api/partner/orders/[orderId]/cod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePartnerRequest.mockResolvedValue({
      partner: { _id: 'p1', businessName: 'Campus Print' },
      userId: 'u_partner',
    });
  });

  it('approves COD order, queues PrintJob, and updates conversation approval status', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({ _id: 'o1', orderId: 'ORD1', paymentMethod: 'cod', status: 'pending_cod_approval' }),
    });
    mocks.orderFindOneAndUpdate.mockReturnValue({
      lean: async () => ({ _id: 'o1', orderId: 'ORD1', paymentMethod: 'cod', status: 'processing' }),
    });

    const req = new NextRequest('http://localhost/api/partner/orders/ORD1/cod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    const res = await POST(req, { params: Promise.resolve({ orderId: 'ORD1' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, job: { jobId: 'JORD1', status: 'queued' } });
    expect(mocks.createJobForOrder).toHaveBeenCalledWith('ORD1', expect.objectContaining({ actor: 'partner:p1' }));
    expect(mocks.convUpdateOne).toHaveBeenCalledWith({ conversationId: 'chat_1' }, { $set: { codApprovalStatus: 'approved' } });
  });

  it('declines unapproved COD order cleanly without Razorpay', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({ _id: 'o1', orderId: 'ORD1', paymentMethod: 'cod', status: 'pending_cod_approval' }),
    });
    mocks.orderFindOneAndUpdate.mockReturnValue({
      lean: async () => ({ _id: 'o1', orderId: 'ORD1', status: 'cancelled' }),
    });

    const req = new NextRequest('http://localhost/api/partner/orders/ORD1/cod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decline', reason: 'No confirmation in chat' }),
    });
    const res = await POST(req, { params: Promise.resolve({ orderId: 'ORD1' }) });
    expect(res.status).toBe(200);
    expect(mocks.createJobForOrder).not.toHaveBeenCalled();
    expect(mocks.convUpdateOne).toHaveBeenCalledWith({ conversationId: 'chat_1' }, { $set: { codApprovalStatus: 'rejected' } });
  });

  it('marks no-show, cancels job, increments failedCodCount and blocks customer COD', async () => {
    mocks.orderFindOne.mockReturnValue({
      lean: async () => ({
        _id: 'o1',
        orderId: 'ORD1',
        paymentMethod: 'cod',
        status: 'ready_for_pickup',
        customerInfo: { email: 'Defaulter@Example.com' },
      }),
    });
    mocks.orderFindOneAndUpdate.mockReturnValue({
      lean: async () => ({ _id: 'o1', orderId: 'ORD1', status: 'cancelled' }),
    });
    mocks.printJobFindOneAndUpdate.mockReturnValue({
      lean: async () => ({ partnerId: 'p1' }),
    });

    const req = new NextRequest('http://localhost/api/partner/orders/ORD1/cod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'no_show' }),
    });
    const res = await POST(req, { params: Promise.resolve({ orderId: 'ORD1' }) });
    expect(res.status).toBe(200);
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { email: 'defaulter@example.com' },
      { $inc: { failedCodCount: 1 }, $set: { codBlocked: true } }
    );
  });
});

