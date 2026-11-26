import 'server-only';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Conversation, { type IConversation } from '@/models/Conversation';
import ChatMessage, { type ChatSenderType, type IChatMessage } from '@/models/ChatMessage';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { getSessionUser, resolvePartnerRequest } from '@/lib/authz';
import { notifyPartnerChat } from '@/lib/wssClient';

export type ChatActor =
  | { role: 'partner'; partnerId: string; partnerName: string; userId: string }
  | { role: 'customer'; email: string; name: string; userId: string };

/**
 * Resolves whether the HTTP request acts as a partner or customer.
 * Explicit `?role=partner` or an `Authorization: Bearer` partner token uses partner mode;
 * otherwise resolves the signed-in customer session.
 */
export async function resolveChatActor(
  request: Request,
  explicitRole?: string | null
): Promise<ChatActor | { error: string; status: number }> {
  if (request.headers.get('authorization') || explicitRole === 'partner') {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) {
      return { error: 'Partner authentication required', status: resolved.status || 401 };
    }
    return {
      role: 'partner',
      partnerId: String(resolved.partner._id),
      partnerName: resolved.partner.businessName || 'Print Shop',
      userId: resolved.userId,
    };
  }

  const user = await getSessionUser();
  if (!user) return { error: 'Authentication required', status: 401 };
  return {
    role: 'customer',
    email: user.email.toLowerCase(),
    name: user.name || user.email.split('@')[0] || 'Customer',
    userId: user.id || user.email,
  };
}

function makeConvId(): string {
  return `chat_${crypto.randomBytes(8).toString('hex')}`;
}

export async function ensureOrderConversation(opts: {
  orderId: string;
}): Promise<IConversation> {
  await connectDB();
  const key = `order:${opts.orderId}`;
  const existing = await Conversation.findOne({ key }).lean<IConversation | null>();
  if (existing) return existing;

  const order = await Order.findOne({ orderId: opts.orderId }).lean<Record<string, any> | null>();
  if (!order) throw new Error('Order not found');

  const partnerId = String(order.deliveryOption?.partnerId || order.partnerId || '');
  if (!partnerId) throw new Error('This order has no assigned print shop');
  const partner = await Partner.findById(partnerId).select('businessName').lean<{ businessName?: string } | null>();

  const slot = order.deliveryOption?.scheduledSlot;
  const created = await Conversation.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        conversationId: makeConvId(),
        key,
        orderId: order.orderId,
        partnerId,
        partnerName: partner?.businessName || 'Print Shop',
        customerEmail: String(order.customerInfo?.email || '').toLowerCase(),
        customerName: order.customerInfo?.name || 'Customer',
        customerPhone: order.customerInfo?.phone,
        pickupPointName: order.deliveryOption?.partnerDeliveryPoint,
        ...(slot?.date ? { scheduledSlot: { date: slot.date, label: slot.label } } : {}),
        status: 'open',
        codApprovalStatus: 'none',
        lastMessageAt: order.createdAt || new Date(),
        lastMessagePreview: `Order #${order.orderId} conversation started`,
        unreadCustomer: 0,
        unreadPartner: 0,
      },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean<IConversation>();

  return created!;
}

export async function ensureShopConversation(opts: {
  partnerId: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  pickupPointName?: string;
}): Promise<IConversation> {
  await connectDB();
  const email = opts.customerEmail.trim().toLowerCase();
  const key = `shop:${opts.partnerId}:${email}`;
  const existing = await Conversation.findOne({ key }).lean<IConversation | null>();
  if (existing) return existing;

  const partner = await Partner.findById(opts.partnerId).select('businessName').lean<{ businessName?: string } | null>();
  if (!partner) throw new Error('Shop not found');

  const created = await Conversation.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        conversationId: makeConvId(),
        key,
        partnerId: String(opts.partnerId),
        partnerName: partner.businessName || 'Print Shop',
        customerEmail: email,
        customerName: opts.customerName || 'Customer',
        customerPhone: opts.customerPhone,
        pickupPointName: opts.pickupPointName,
        status: 'open',
        codApprovalStatus: 'none',
        lastMessageAt: new Date(),
        lastMessagePreview: 'Conversation started',
        unreadCustomer: 0,
        unreadPartner: 0,
      },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean<IConversation>();

  return created!;
}

export async function appendChatMessage(opts: {
  conversationId: string;
  senderType: ChatSenderType;
  senderId: string;
  senderName: string;
  body: string;
  metadata?: Record<string, unknown>;
  aiPauseMinutes?: number;
}): Promise<{ message: IChatMessage; conversation: IConversation }> {
  await connectDB();
  const body = opts.body.trim().slice(0, 2000);
  const now = new Date();
  const pauseMins = Math.min(240, Math.max(5, Math.round(opts.aiPauseMinutes ?? 45)));

  const messageDoc = await ChatMessage.create({
    conversationId: opts.conversationId,
    senderType: opts.senderType,
    senderId: opts.senderId,
    senderName: opts.senderName,
    body,
    metadata: opts.metadata,
  });

  const inc: Record<string, number> = {};
  if (opts.senderType === 'customer') inc.unreadPartner = 1;
  else if (opts.senderType === 'partner' || opts.senderType === 'ai_bot' || opts.senderType === 'system') {
    inc.unreadCustomer = 1;
  }

  const update: Record<string, unknown> = {
    $set: {
      lastMessageAt: now,
      lastMessagePreview: body.slice(0, 140),
      status: 'open',
      ...(opts.senderType === 'partner'
        ? {
            aiPausedUntil: new Date(now.getTime() + pauseMins * 60_000),
            needsHumanAttention: false,
            escalationReason: '',
          }
        : {}),
    },
    ...(Object.keys(inc).length ? { $inc: inc } : {}),
  };

  const conv = await Conversation.findOneAndUpdate(
    { conversationId: opts.conversationId },
    update,
    { returnDocument: 'after' }
  ).lean<IConversation | null>();

  if (!conv) throw new Error('Conversation not found');

  if (opts.senderType === 'customer') {
    void notifyPartnerChat(conv.partnerId, {
      conversationId: conv.conversationId,
      orderId: conv.orderId,
      senderName: opts.senderName,
      preview: body.slice(0, 140),
    }).catch(() => undefined);
  }

  return { message: messageDoc.toObject(), conversation: conv };
}
