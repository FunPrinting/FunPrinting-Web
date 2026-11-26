import { NextRequest, NextResponse, after } from 'next/server';
import connectDB from '@/lib/mongodb';
import { requireUser } from '@/lib/authz';
import { appendChatMessage, ensureOrderConversation } from '@/lib/chat/service';
import { syncJobFromOrderStatus } from '@/lib/jobs/service';
import Order from '@/models/Order';

/**
 * POST /api/orders/[id]/collect-qr
 * Verified-owner pickup handover confirmation (triggered after scanning the Order Summary QR).
 * Only the signed-in customer who owns the order may mark it collected (and settle COD cash).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    await connectDB();
    const { id: param } = await params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(param);
    const order = await Order.findOne(isObjectId ? { _id: param } : { orderId: param }).lean<Record<string, any> | null>();

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const ownerEmail = String(order.customerInfo?.email || '').toLowerCase();
    if (!ownerEmail || ownerEmail !== user.email.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Sign in with the customer account that placed this order to confirm pickup.' },
        { status: 403 }
      );
    }

    if (order.status === 'completed') {
      return NextResponse.json({ success: true, alreadyCollected: true, order });
    }

    if (order.deliveryOption?.type !== 'pickup') {
      return NextResponse.json({ success: false, error: 'QR pickup verification is only for pickup orders' }, { status: 400 });
    }

    if (!['printed', 'ready_for_pickup'].includes(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error:
            order.status === 'pending_cod_approval' || order.status === 'pending_payment'
              ? 'This order is not printed yet.'
              : `Order in status "${order.status}" cannot be marked collected yet.`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const isCod = order.paymentMethod === 'cod';
    const settleCash = isCod && order.paymentStatus !== 'completed';
    const collectedTotal = order.pricing?.total ?? order.amount;

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: { $in: ['printed', 'ready_for_pickup'] } },
      {
        $set: {
          status: 'completed',
          orderStatus: 'completed',
          deliveryVerifiedAt: now,
          deliveryVerifiedBy: user.email.toLowerCase(),
          'cod.qrVerifiedAt': now,
          'cod.qrVerifiedByEmail': user.email.toLowerCase(),
          ...(settleCash
            ? {
                paymentStatus: 'completed',
                amountPaid: collectedTotal,
                paidAt: now,
                'cod.cashCollectedAt': now,
                'cod.cashCollectedBy': 'customer_qr_verified',
              }
            : {}),
        },
      },
      { returnDocument: 'after' }
    ).lean<Record<string, any> | null>();

    if (!updated) {
      const latest = await Order.findById(order._id).lean<Record<string, any> | null>();
      if (latest?.status === 'completed') {
        return NextResponse.json({ success: true, alreadyCollected: true, order: latest });
      }
      return NextResponse.json({ success: false, error: 'Order updated meanwhile; refresh and try again' }, { status: 409 });
    }

    after(async () => {
      await syncJobFromOrderStatus(updated.orderId, 'completed', `customer:${user.email}`).catch(() => undefined);
      try {
        const conv = await ensureOrderConversation({ orderId: updated.orderId });
        await appendChatMessage({
          conversationId: conv.conversationId,
          senderType: 'system',
          senderId: user.email,
          senderName: updated.customerInfo?.name || 'Customer',
          body: settleCash
            ? `✅ Verified owner scanned pickup QR — Cash of ₹${collectedTotal} settled & order #${updated.orderId} marked Collected.`
            : `✅ Verified owner scanned pickup QR — order #${updated.orderId} marked Collected.`,
          metadata: { kind: 'qr_collected', orderId: updated.orderId },
        });
      } catch {
        // non-blocking
      }
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    console.error('Error confirming QR pickup:', error);
    return NextResponse.json({ success: false, error: 'Could not confirm pickup' }, { status: 500 });
  }
}

