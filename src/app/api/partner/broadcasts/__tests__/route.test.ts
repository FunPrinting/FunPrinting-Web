import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolvePartnerRequest: vi.fn(),
  ensureOrderConversation: vi.fn(),
  appendChatMessage: vi.fn(),
  sendPickupBroadcastEmail: vi.fn(),
  orderCountDocuments: vi.fn(),
  orderFind: vi.fn(),
  broadcastFindOne: vi.fn(),
  broadcastFind: vi.fn(),
  broadcastCreate: vi.fn(),
}));

vi.mock('@/lib/authz', () => ({ resolvePartnerRequest: mocks.resolvePartnerRequest }));
vi.mock('@/lib/chat/service', () => ({
  ensureOrderConversation: mocks.ensureOrderConversation,
  appendChatMessage: mocks.appendChatMessage,
}));
vi.mock('@/lib/jobs/emails', () => ({
  sendPickupBroadcastEmail: mocks.sendPickupBroadcastEmail,
}));
vi.mock('@/models/Order', () => ({
  default: {
    countDocuments: mocks.orderCountDocuments,
    find: mocks.orderFind,
  },
}));
vi.mock('@/models/PickupBroadcast', () => ({
  default: {
    findOne: mocks.broadcastFindOne,
    find: mocks.broadcastFind,
    create: mocks.broadcastCreate,
  },
}));

import { GET, POST } from '@/app/api/partner/broadcasts/route';

const PARTNER = {
  _id: 'partner_1',
  businessName: 'North Gate Prints',
  deliveryPoints: [{ name: 'Gate 1', isActive: true }, { name: 'Library', isActive: false }],
};

describe('/api/partner/broadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePartnerRequest.mockResolvedValue({ partner: PARTNER, userId: 'u_partner' });
  });

  it('previews active recipient count scoped to partner, pickup point, and optional date', async () => {
    mocks.orderCountDocuments.mockResolvedValue(4);
    const req = new NextRequest(
      'http://localhost/api/partner/broadcasts?preview=1&pickupPoint=Gate%201&date=2026-11-27'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, recipientCount: 4 });
    expect(mocks.orderCountDocuments).toHaveBeenCalledWith({
      partnerId: 'partner_1',
      'deliveryOption.partnerDeliveryPoint': 'Gate 1',
      'deliveryOption.scheduledSlot.date': '2026-11-27',
      status: { $in: ['paid', 'processing', 'printing', 'printed', 'ready_for_pickup'] },
    });
  });

  it('rejects too-short broadcast messages with 400', async () => {
    const req = new NextRequest('http://localhost/api/partner/broadcasts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickupPointName: 'Gate 1', message: 'hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('blocks identical duplicate broadcast within 3 minutes with 429', async () => {
    mocks.broadcastFindOne.mockReturnValue({ lean: async () => ({ _id: 'dup1' }) });
    const req = new NextRequest('http://localhost/api/partner/broadcasts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickupPointName: 'Gate 1', message: 'Van has arrived at Gate 1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(mocks.orderFind).not.toHaveBeenCalled();
  });

  it('fans out system chat messages and emails to matching orders and persists PickupBroadcast', async () => {
    mocks.broadcastFindOne.mockReturnValue({ lean: async () => null });
    mocks.orderFind.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [
            { orderId: 'ORD1', customerInfo: { name: 'Asha', email: 'asha@example.com' }, deliveryNumber: 'D-01' },
            { orderId: 'ORD2', customerInfo: { name: 'Ravi' } },
          ],
        }),
      }),
    });
    mocks.ensureOrderConversation
      .mockResolvedValueOnce({ conversationId: 'chat_1' })
      .mockResolvedValueOnce({ conversationId: 'chat_2' });
    mocks.appendChatMessage.mockResolvedValue({});
    mocks.sendPickupBroadcastEmail.mockResolvedValue(true);
    mocks.broadcastCreate.mockImplementation(async (doc) => ({ _id: 'b1', ...doc }));

    const req = new NextRequest('http://localhost/api/partner/broadcasts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pickupPointName: 'Gate 1',
        scheduledDate: '2026-11-27',
        message: 'Courier parked near Gate 1 bench for next 30 mins.',
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      recipientCount: 2,
      chatMessagesCreated: 2,
      emailsSent: 1,
    });
    expect(mocks.appendChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendPickupBroadcastEmail).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: 'partner_1',
        pickupPointName: 'Gate 1',
        scheduledDate: '2026-11-27',
        recipientCount: 2,
        chatMessagesCreated: 2,
        emailsSent: 1,
      })
    );
  });
});

