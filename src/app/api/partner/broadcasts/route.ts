import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePartnerRequest } from '@/lib/authz';
import { appendChatMessage, ensureOrderConversation } from '@/lib/chat/service';
import { sendPickupBroadcastEmail } from '@/lib/jobs/emails';
import Order from '@/models/Order';
import PickupBroadcast from '@/models/PickupBroadcast';

const ACTIVE_PICKUP_STATUSES = ['paid', 'processing', 'printing', 'printed', 'ready_for_pickup'];

const broadcastSchema = z.object({
  pickupPointName: z.string().trim().min(1, 'Choose a pickup point').max(200),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  message: z.string().trim().min(3, 'Enter a message for customers').max(1000),
});

function buildMatchingOrderFilter(partnerId: string, pickupPointName: string, scheduledDate?: string) {
  const filter: Record<string, unknown> = {
    partnerId: String(partnerId),
    'deliveryOption.partnerDeliveryPoint': pickupPointName,
    status: { $in: ACTIVE_PICKUP_STATUSES },
  };
  if (scheduledDate) {
    filter['deliveryOption.scheduledSlot.date'] = scheduledDate;
  }
  return filter;
}

/**
 * GET /api/partner/broadcasts?preview=1&pickupPoint=...&date=...
 * Returns recent pickup-point broadcasts or previews matching order count.
 */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(req);
    if (resolved instanceof NextResponse) return resolved;

    const { partner } = resolved;
    const partnerId = String(partner._id);
    const sp = req.nextUrl.searchParams;

    if (sp.get('preview') === '1') {
      const pickupPoint = sp.get('pickupPoint')?.trim() || '';
      if (!pickupPoint) {
        return NextResponse.json({ success: true, recipientCount: 0 });
      }
      const date = sp.get('date')?.trim() || undefined;
      const recipientCount = await Order.countDocuments(buildMatchingOrderFilter(partnerId, pickupPoint, date));
      return NextResponse.json({ success: true, recipientCount });
    }

    const broadcasts = await PickupBroadcast.find({ partnerId }).sort({ createdAt: -1 }).limit(20).lean();
    const deliveryPoints = ((partner.deliveryPoints || []) as Array<{ name: string; isActive?: boolean }>).filter(
      (dp) => dp.isActive !== false
    );

    return NextResponse.json({
      success: true,
      broadcasts,
      deliveryPoints: deliveryPoints.map((d) => ({ name: d.name })),
    });
  } catch (error) {
    console.error('Error loading partner broadcasts:', error);
    return NextResponse.json({ success: false, error: 'Failed to load broadcasts' }, { status: 500 });
  }
}

/**
 * POST /api/partner/broadcasts
 * Sends a pickup-point arrival/status broadcast to all active orders at that pickup point via chat + email.
 */
export async function POST(req: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(req);
    if (resolved instanceof NextResponse) return resolved;

    const { partner, userId } = resolved;
    const partnerId = String(partner._id);
    const partnerName = partner.businessName || 'Print Shop';

    const raw = await req.json().catch(() => null);
    const parsed = broadcastSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid broadcast request' },
        { status: 400 }
      );
    }

    const { pickupPointName, scheduledDate, message } = parsed.data;

    // Anti-spam guard: prevent identical accidental double-send within 3 minutes
    const threeMinAgo = new Date(Date.now() - 3 * 60_000);
    const duplicate = await PickupBroadcast.findOne({
      partnerId,
      pickupPointName,
      message,
      createdAt: { $gte: threeMinAgo },
    }).lean();
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: 'This exact broadcast was just sent. Wait a couple of minutes before resending.' },
        { status: 429 }
      );
    }

    const orders = await Order.find(buildMatchingOrderFilter(partnerId, pickupPointName, scheduledDate))
      .select('orderId customerInfo deliveryNumber')
      .limit(200)
      .lean<Array<{ orderId: string; customerInfo?: { name?: string; email?: string }; deliveryNumber?: string }>>();

    const site = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || 'https://www.funprinting.store').replace(/\/+$/, '');
    let chatMessagesCreated = 0;
    let emailsSent = 0;

    await Promise.all(
      orders.map(async (ord) => {
        try {
          const conv = await ensureOrderConversation({ orderId: ord.orderId });
          await appendChatMessage({
            conversationId: conv.conversationId,
            senderType: 'system',
            senderId: partnerId,
            senderName: partnerName,
            body: `📢 ${pickupPointName} Update: ${message}`,
            metadata: { kind: 'pickup_broadcast', pickupPointName },
          });
          chatMessagesCreated++;
        } catch {
          // continue notifying remaining orders
        }

        const email = ord.customerInfo?.email?.trim();
        if (email) {
          const sent = await sendPickupBroadcastEmail({
            to: email,
            name: ord.customerInfo?.name || 'Customer',
            shop: partnerName,
            pickupPoint: pickupPointName,
            orderId: ord.orderId,
            deliveryNumber: ord.deliveryNumber,
            message,
            orderUrl: `${site}/orders/${encodeURIComponent(ord.orderId)}`,
          });
          if (sent) emailsSent++;
        }
      })
    );

    const broadcast = await PickupBroadcast.create({
      partnerId,
      partnerName,
      pickupPointName,
      scheduledDate,
      message,
      recipientCount: orders.length,
      emailsSent,
      chatMessagesCreated,
      sentByUserId: userId,
    });

    return NextResponse.json({
      success: true,
      broadcast,
      recipientCount: orders.length,
      emailsSent,
      chatMessagesCreated,
    });
  } catch (error) {
    console.error('Error sending pickup broadcast:', error);
    return NextResponse.json({ success: false, error: 'Failed to send broadcast' }, { status: 500 });
  }
}

