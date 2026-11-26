import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import Order from '@/models/Order';
import { canAccessOrder, isAdminSession, getSessionUser } from '@/lib/authz';
import { ensureOrderConversation, ensureShopConversation, resolveChatActor } from '@/lib/chat/service';

const createConvSchema = z.object({
  orderId: z.string().trim().min(3).max(64).optional(),
  partnerId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  pickupPointName: z.string().trim().max(200).optional(),
});

/**
 * GET /api/chat/conversations?role=customer|partner&pickupPoint=...
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const roleHint = sp.get('role');
    const actor = await resolveChatActor(req, roleHint);
    if ('error' in actor) {
      return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
    }

    await connectDB();

    if (actor.role === 'partner') {
      const pickupPoint = sp.get('pickupPoint')?.trim();
      const query: Record<string, unknown> = { partnerId: actor.partnerId };
      if (pickupPoint && pickupPoint !== '__all__') {
        query.pickupPointName = pickupPoint;
      }
      const conversations = await Conversation.find(query)
        .sort({ lastMessageAt: -1 })
        .limit(100)
        .lean();
      const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadPartner || 0), 0);
      return NextResponse.json({ success: true, role: 'partner', conversations, unreadTotal });
    }

    const conversations = await Conversation.find({ customerEmail: actor.email })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();
    const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCustomer || 0), 0);
    return NextResponse.json({ success: true, role: 'customer', conversations, unreadTotal });
  } catch (error) {
    console.error('Error listing conversations:', error);
    return NextResponse.json({ success: false, error: 'Failed to load conversations' }, { status: 500 });
  }
}

/**
 * POST /api/chat/conversations
 * Opens or returns the conversation for an orderId or partnerId.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = createConvSchema.safeParse(body);
    if (!parsed.success || (!parsed.data.orderId && !parsed.data.partnerId)) {
      return NextResponse.json({ success: false, error: 'Provide orderId or partnerId' }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const actor = await resolveChatActor(req, sp.get('role'));
    if ('error' in actor) {
      return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
    }

    await connectDB();

    if (parsed.data.orderId) {
      const order = await Order.findOne({ orderId: parsed.data.orderId }).lean<Record<string, any> | null>();
      if (!order) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }
      const orderPartnerId = String(order.deliveryOption?.partnerId || order.partnerId || '');
      if (actor.role === 'partner') {
        if (orderPartnerId !== actor.partnerId) {
          return NextResponse.json({ success: false, error: 'Order does not belong to your shop' }, { status: 403 });
        }
      } else {
        const sessionUser = await getSessionUser();
        if (!canAccessOrder(sessionUser, order) && !isAdminSession(sessionUser)) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      }
      const conversation = await ensureOrderConversation({ orderId: parsed.data.orderId });
      return NextResponse.json({ success: true, conversation });
    }

    if (actor.role !== 'customer') {
      return NextResponse.json({ success: false, error: 'Only customers can start a general shop chat' }, { status: 400 });
    }

    const conversation = await ensureShopConversation({
      partnerId: parsed.data.partnerId!,
      customerEmail: actor.email,
      customerName: actor.name,
      pickupPointName: parsed.data.pickupPointName,
    });
    return NextResponse.json({ success: true, conversation });
  } catch (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to open chat' },
      { status: 500 }
    );
  }
}

