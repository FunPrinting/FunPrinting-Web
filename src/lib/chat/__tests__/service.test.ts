import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  getSessionUser: vi.fn(),
  resolvePartnerRequest: vi.fn(),
  notifyPartnerChat: vi.fn(async () => ({ ok: true, delivered: 1 })),
  chatMessageCreate: vi.fn(),
  convFindOne: vi.fn(),
  convFindOneAndUpdate: vi.fn(),
  orderFindOne: vi.fn(),
  partnerFindById: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/mongodb', () => ({ default: mocks.connectDB }));
vi.mock('@/lib/authz', () => ({
  getSessionUser: mocks.getSessionUser,
  resolvePartnerRequest: mocks.resolvePartnerRequest,
}));
vi.mock('@/lib/wssClient', () => ({ notifyPartnerChat: mocks.notifyPartnerChat }));
vi.mock('@/models/ChatMessage', () => ({
  default: { create: mocks.chatMessageCreate },
}));
vi.mock('@/models/Conversation', () => ({
  default: {
    findOne: mocks.convFindOne,
    findOneAndUpdate: mocks.convFindOneAndUpdate,
  },
}));
vi.mock('@/models/Order', () => ({ default: { findOne: mocks.orderFindOne } }));
vi.mock('@/models/Partner', () => ({ default: { findById: mocks.partnerFindById } }));

import { appendChatMessage, resolveChatActor } from '@/lib/chat/service';

describe('chat/service resolveChatActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses partner resolver when explicitRole=partner or Authorization header is present', async () => {
    mocks.resolvePartnerRequest.mockResolvedValue({
      partner: { _id: 'p1', businessName: 'Campus Print' },
      userId: 'u_partner',
    });

    const byRole = await resolveChatActor(new Request('http://localhost/api/chat/conversations?role=partner'), 'partner');
    expect(byRole).toEqual({
      role: 'partner',
      partnerId: 'p1',
      partnerName: 'Campus Print',
      userId: 'u_partner',
    });

    const byAuth = await resolveChatActor(
      new Request('http://localhost/api/chat/conversations', { headers: { authorization: 'Bearer tok' } }),
      null
    );
    expect(byAuth).toMatchObject({ role: 'partner', partnerId: 'p1' });
  });

  it('propagates NextResponse failure status for invalid partner auth', async () => {
    mocks.resolvePartnerRequest.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await resolveChatActor(new Request('http://localhost/api/chat?role=partner'), 'partner');
    expect(res).toEqual({ error: 'Partner authentication required', status: 403 });
  });

  it('resolves customer session by default and 401 when signed out', async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    expect(await resolveChatActor(new Request('http://localhost/api/chat'))).toEqual({
      error: 'Authentication required',
      status: 401,
    });

    mocks.getSessionUser.mockResolvedValueOnce({ id: 'u1', email: 'Student@Example.com', name: 'Asha' });
    expect(await resolveChatActor(new Request('http://localhost/api/chat'))).toEqual({
      role: 'customer',
      email: 'student@example.com',
      name: 'Asha',
      userId: 'u1',
    });
  });
});

describe('chat/service appendChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatMessageCreate.mockImplementation(async (doc) => ({
      toObject: () => ({ _id: 'm1', ...doc }),
    }));
  });

  it('increments unreadPartner and notifies WSS on customer message', async () => {
    mocks.convFindOneAndUpdate.mockReturnValue({
      lean: async () => ({
        conversationId: 'chat_abc',
        partnerId: 'p1',
        orderId: 'ORD123',
      }),
    });

    await appendChatMessage({
      conversationId: 'chat_abc',
      senderType: 'customer',
      senderId: 'u1',
      senderName: 'Asha',
      body: '  Please bind it cleanly  ',
    });

    const [, update] = mocks.convFindOneAndUpdate.mock.calls[0];
    expect(update.$inc).toEqual({ unreadPartner: 1 });
    expect(update.$set.lastMessagePreview).toBe('Please bind it cleanly');
    expect(update.$set.aiPausedUntil).toBeUndefined();
    expect(mocks.notifyPartnerChat).toHaveBeenCalledWith('p1', {
      conversationId: 'chat_abc',
      orderId: 'ORD123',
      senderName: 'Asha',
      preview: 'Please bind it cleanly',
    });
  });

  it('increments unreadCustomer and sets aiPausedUntil when partner replies without notifying partner WSS', async () => {
    mocks.convFindOneAndUpdate.mockReturnValue({
      lean: async () => ({
        conversationId: 'chat_abc',
        partnerId: 'p1',
      }),
    });

    await appendChatMessage({
      conversationId: 'chat_abc',
      senderType: 'partner',
      senderId: 'u_partner',
      senderName: 'Campus Print',
      body: 'Ready at Gate 1',
    });

    const [, update] = mocks.convFindOneAndUpdate.mock.calls[0];
    expect(update.$inc).toEqual({ unreadCustomer: 1 });
    expect(update.$set.aiPausedUntil).toBeInstanceOf(Date);
    expect(mocks.notifyPartnerChat).not.toHaveBeenCalled();
  });
});

