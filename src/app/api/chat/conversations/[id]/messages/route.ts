import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import ChatMessage from '@/models/ChatMessage';
import Conversation from '@/models/Conversation';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { appendChatMessage, resolveChatActor } from '@/lib/chat/service';
import { maybeHandleAiAutoReply } from '@/lib/chat/aiResponder';

const sendSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message is too long'),
});

async function authorizeConversation(conversationId: string, req: NextRequest) {
  const actor = await resolveChatActor(req, req.nextUrl.searchParams.get('role'));
  if ('error' in actor) return { error: actor.error, status: actor.status };

  await connectDB();
  const conv = await Conversation.findOne({ conversationId }).lean();
  if (!conv) return { error: 'Conversation not found', status: 404 };

  if (actor.role === 'partner') {
    if (conv.partnerId !== actor.partnerId) return { error: 'Forbidden', status: 403 };
  } else {
    if (conv.customerEmail !== actor.email) return { error: 'Forbidden', status: 403 };
  }

  return { actor, conv };
}

/**
 * GET /api/chat/conversations/[id]/messages?role=...&after=...&peek=1
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const auth = await authorizeConversation(id, req);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const sp = req.nextUrl.searchParams;
    const after = sp.get('after');
    const peek = sp.get('peek') === '1';

    const msgQuery: Record<string, unknown> = { conversationId: id };
    if (after) {
      const dt = new Date(after);
      if (!Number.isNaN(dt.getTime())) msgQuery.createdAt = { $gt: dt };
    }

    const [messages, order] = await Promise.all([
      ChatMessage.find(msgQuery).sort({ createdAt: 1 }).limit(200).lean(),
      auth.conv.orderId
        ? Order.findOne({ orderId: auth.conv.orderId })
            .select('orderId status paymentStatus amount deliveryNumber expectedDate deliveryOption originalFileName originalFileNames')
            .lean()
        : null,
    ]);

    if (!peek) {
      const clearField = auth.actor.role === 'partner' ? { unreadPartner: 0 } : { unreadCustomer: 0 };
      await Conversation.updateOne({ conversationId: id }, { $set: clearField });
    }

    return NextResponse.json({
      success: true,
      conversation: auth.conv,
      order,
      messages,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ success: false, error: 'Failed to load messages' }, { status: 500 });
  }
}

/**
 * POST /api/chat/conversations/[id]/messages?role=...
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const auth = await authorizeConversation(id, req);
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const raw = await req.json().catch(() => null);
    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid message' }, { status: 400 });
    }

    const senderType = auth.actor.role === 'partner' ? 'partner' : 'customer';
    const senderId = auth.actor.role === 'partner' ? auth.actor.partnerId : auth.actor.userId;
    const senderName = auth.actor.role === 'partner' ? auth.actor.partnerName : auth.actor.name;

    let aiPauseMinutes: number | undefined;
    if (auth.actor.role === 'partner') {
      const partnerCfg = await Partner.findById(auth.actor.partnerId)
        .select('aiAssistant.autoPauseMinutes')
        .lean<{ aiAssistant?: { autoPauseMinutes?: number } } | null>();
      aiPauseMinutes = partnerCfg?.aiAssistant?.autoPauseMinutes;
    }

    const result = await appendChatMessage({
      conversationId: id,
      senderType,
      senderId,
      senderName,
      body: parsed.data.body,
      aiPauseMinutes,
    });

    const aiReply =
      senderType === 'customer'
        ? await maybeHandleAiAutoReply({ conversationId: id, messageBody: parsed.data.body }).catch(() => null)
        : null;

    return NextResponse.json({
      success: true,
      message: result.message,
      aiMessage: aiReply?.aiMessage ?? null,
      conversation: aiReply?.conversation ?? result.conversation,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json({ success: false, error: 'Failed to send message' }, { status: 500 });
  }
}

