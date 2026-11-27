import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeterministicGroundedReply,
  buildEscalationHandoffMessage,
  detectEscalation,
  type AiGroundContext,
} from '@/lib/chat/aiLogic';

const mocks = vi.hoisted(() => ({
  convFindOne: vi.fn(),
  convUpdateOne: vi.fn(async () => ({})),
  partnerFindById: vi.fn(),
  orderFindOne: vi.fn(),
  broadcastFindOne: vi.fn(),
  chatMessageFindOne: vi.fn(),
  appendChatMessage: vi.fn(async (args) => ({
    message: { _id: 'bot_1', ...args },
    conversation: { conversationId: args.conversationId },
  })),
  notifyPartnerChat: vi.fn(async () => ({ ok: true, delivered: 1 })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/models/Conversation', () => ({
  default: { findOne: mocks.convFindOne, updateOne: mocks.convUpdateOne },
}));
vi.mock('@/models/Partner', () => ({ default: { findById: mocks.partnerFindById } }));
vi.mock('@/models/Order', () => ({ default: { findOne: mocks.orderFindOne } }));
vi.mock('@/models/PickupBroadcast', () => ({ default: { findOne: mocks.broadcastFindOne } }));
vi.mock('@/models/ChatMessage', () => ({ default: { findOne: mocks.chatMessageFindOne } }));
vi.mock('@/lib/chat/service', () => ({ appendChatMessage: mocks.appendChatMessage }));
vi.mock('@/lib/wssClient', () => ({ notifyPartnerChat: mocks.notifyPartnerChat }));

import { maybeHandleAiAutoReply } from '@/lib/chat/aiResponder';

const SAMPLE_CTX: AiGroundContext = {
  shop: {
    businessName: 'Campus Prints',
    address: 'Main Gate Road, Dehradun',
    phoneNumbers: ['+919999988888'],
    faqNotes: 'Spiral binding takes 10 extra minutes.',
    deliveryPoints: [{ name: 'Let Me Bake', contactNumber: '+918888877777' }],
    scheduleSummary: ['Main Store: 10 AM - 1 PM', 'Let Me Bake: 1 PM - 1:30 PM'],
    cod: { enabled: true, allowAtPickupPoints: false, maxOrderAmount: 200, cashFee: 5 },
  },
  order: {
    orderId: 'ORD500',
    status: 'ready_for_pickup',
    deliveryNumber: 'A012',
    paymentMethod: 'cod',
    paymentStatus: 'cod_pending',
    amount: 125,
    pickupPointName: 'Let Me Bake',
    scheduledSlot: { date: '2026-11-27', label: '1:00 PM - 1:30 PM' },
  },
  latestBroadcast: {
    pickupPointName: 'Let Me Bake',
    message: 'Reached Let Me Bake gate, wearing blue jacket!',
    createdAt: '2026-11-26T08:00:00.000Z',
  },
};

describe('aiLogic escalation and grounded replies', () => {
  it('flags refunds, quality issues, human requests, urgencies, and COD confirmations', () => {
    expect(detectEscalation('I need a refund for this order')).toMatchObject({ escalate: true, category: 'refund' });
    expect(detectEscalation('Pages are smudged and torn')).toMatchObject({ escalate: true, category: 'quality' });
    expect(detectEscalation('Can I talk to the shop owner?')).toMatchObject({ escalate: true, category: 'human_request' });
    expect(detectEscalation('This is urgent, exam in 10 mins')).toMatchObject({ escalate: true, category: 'urgent' });
    expect(
      detectEscalation('Yes please print, I will pay cash', { paymentMethod: 'cod', orderStatus: 'pending_cod_approval' })
    ).toMatchObject({ escalate: true, category: 'cod_confirm' });
    expect(detectEscalation('Where is my order status?')).toEqual({ escalate: false });
  });

  it('grounds order status, pickup broadcasts, and COD rules from live context', () => {
    const statusReply = buildDeterministicGroundedReply(SAMPLE_CTX, 'Where is my order status?');
    expect(statusReply).toContain('ORD500');
    expect(statusReply).toContain('A012');
    expect(statusReply).toContain('₹125');

    const broadcastReply = buildDeterministicGroundedReply(SAMPLE_CTX, 'Have you reached Let Me Bake?');
    expect(broadcastReply).toContain('Reached Let Me Bake gate, wearing blue jacket!');

    const codReply = buildDeterministicGroundedReply(SAMPLE_CTX, 'Can I pay cash COD or Razorpay?');
    expect(codReply).toContain('Razorpay');
    expect(codReply).toContain('₹200');
    expect(codReply).toContain('₹5 cash handling fee');

    const handoff = buildEscalationHandoffMessage(
      { escalate: true, category: 'cod_confirm', reason: 'confirm' },
      SAMPLE_CTX
    );
    expect(handoff).toContain('Approve & Print');
  });
});

describe('maybeHandleAiAutoReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', '');
    mocks.convFindOne.mockReturnValue({
      lean: async () => ({
        conversationId: 'chat_1',
        partnerId: 'p1',
        orderId: 'ORD500',
        customerName: 'Asha',
        pickupPointName: 'Let Me Bake',
      }),
    });
    mocks.partnerFindById.mockReturnValue({
      select: () => ({
        lean: async () => ({
          businessName: 'Campus Prints',
          address: { street: 'Main Gate' },
          phoneNumbers: ['+919999988888'],
          deliveryPoints: [{ name: 'Let Me Bake', isActive: true }],
          scheduleSlots: [],
          cod: { enabled: true, allowAtPickupPoints: false, maxOrderAmount: 200, cashFee: 0 },
          aiAssistant: { enabled: true, faqNotes: 'Open till 8 PM', autoPauseMinutes: 45 },
        }),
      }),
    });
    mocks.orderFindOne.mockReturnValue({
      select: () => ({
        lean: async () => ({
          orderId: 'ORD500',
          status: 'printed',
          paymentMethod: 'online',
          paymentStatus: 'completed',
          amount: 80,
          deliveryOption: { type: 'pickup', scheduledSlot: { date: '2026-11-27', label: '10 AM - 12 PM' } },
        }),
      }),
    });
    mocks.broadcastFindOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
    mocks.chatMessageFindOne.mockReturnValue({ lean: async () => null });
  });

  it('stays silent during active aiPausedUntil window while still escalating urgent messages', async () => {
    mocks.convFindOne.mockReturnValue({
      lean: async () => ({
        conversationId: 'chat_1',
        partnerId: 'p1',
        orderId: 'ORD500',
        customerName: 'Asha',
        aiPausedUntil: new Date(Date.now() + 20 * 60_000),
      }),
    });

    const reply = await maybeHandleAiAutoReply({
      conversationId: 'chat_1',
      messageBody: 'I want a refund please',
    });

    expect(reply).toBeNull();
    expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    expect(mocks.convUpdateOne).toHaveBeenCalledWith(
      { conversationId: 'chat_1' },
      { $set: expect.objectContaining({ needsHumanAttention: true }) }
    );
  });

  it('appends grounded ai_bot reply when active and falls back safely if Gemini fails', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    const reply = await maybeHandleAiAutoReply({
      conversationId: 'chat_1',
      messageBody: 'What is the status of my order?',
    });

    expect(reply).not.toBeNull();
    expect(mocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'chat_1',
        senderType: 'ai_bot',
        senderName: 'Campus Prints Assistant',
        metadata: expect.objectContaining({
          kind: 'ai_reply',
          source: 'grounded_fallback',
          fallbackReason: 'http_500',
        }),
      })
    );
  });

  it('uses Gemini response (filtering thought parts) and falls back to gemini-2.5-flash on 404', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'internal reasoning...', thought: true },
                    { text: 'Your order #ORD500 is printed and ready for your 10 AM – 12 PM pickup slot.' },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const reply = await maybeHandleAiAutoReply({
      conversationId: 'chat_1',
      messageBody: 'Hey are you Gemini?',
    });

    expect(reply).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Your order #ORD500 is printed and ready for your 10 AM – 12 PM pickup slot.',
        metadata: expect.objectContaining({
          kind: 'ai_reply',
          source: 'gemini',
          model: 'gemini-2.5-flash',
        }),
      })
    );
  });
});

