import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import { resolvePartnerRequest } from '@/lib/authz';
import { appendChatMessage, ensureOrderConversation } from '@/lib/chat/service';
import { createJobForOrder, announce } from '@/lib/jobs/service';
import { forPartner } from '@/lib/partnerOrderView';
import Conversation from '@/models/Conversation';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';
import User from '@/models/User';

const codActionSchema = z.object({
  action: z.enum(['approve', 'decline', 'no_show', 'mark_collected']),
  reason: z.string().trim().max(240).optional(),
});

/**
 * POST /api/partner/orders/[orderId]/cod
 * Partner actions for Cash on Pickup orders:
 * - approve: approves COD after chat verification and queues PrintJob
 * - decline: cancels unprinted COD request cleanly (never calls Razorpay)
 * - no_show: cancels order + increments User.failedCodCount & blocks future COD
 * - mark_collected: counter fallback to record cash received and complete pickup
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const resolved = await resolvePartnerRequest(req);
    if (resolved instanceof NextResponse) return resolved;

    const parsed = codActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid COD action' }, { status: 400 });
    }

    const { partner } = resolved;
    const partnerIdStr = String(partner._id);
    const partnerName = partner.businessName || 'Print Shop';
    const { orderId } = await params;
    const { action, reason } = parsed.data;

    await connectDB();
    const ownedBy = { $or: [{ partnerId: partnerIdStr }, { 'deliveryOption.partnerId': partnerIdStr }] };
    const order = await Order.findOne({ orderId, ...ownedBy }).lean<Record<string, any> | null>();
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (order.paymentMethod !== 'cod') {
      return NextResponse.json({ success: false, error: 'This action applies to Cash on Pickup orders only' }, { status: 400 });
    }

    const now = new Date();

    if (action === 'approve') {
      if (order.status !== 'pending_cod_approval') {
        return NextResponse.json({ success: false, error: `Order is already ${order.status}` }, { status: 409 });
      }
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending_cod_approval', paymentMethod: 'cod', ...ownedBy },
        {
          $set: {
            status: 'processing',
            orderStatus: 'processing',
            'cod.approvedAt': now,
            'cod.approvedBy': `partner:${partnerIdStr}`,
          },
        },
        { returnDocument: 'after' }
      ).lean<Record<string, any> | null>();
      if (!updated) {
        return NextResponse.json({ success: false, error: 'Order changed meanwhile; refresh and try again' }, { status: 409 });
      }

      const job = await createJobForOrder(orderId, { actor: `partner:${partnerIdStr}`, paidAt: now });
      try {
        const conv = await ensureOrderConversation({ orderId });
        await Conversation.updateOne({ conversationId: conv.conversationId }, { $set: { codApprovalStatus: 'approved' } });
        await appendChatMessage({
          conversationId: conv.conversationId,
          senderType: 'system',
          senderId: partnerIdStr,
          senderName: partnerName,
          body: `✅ Cash on Pickup approved by ${partnerName} — sent to print queue!`,
          metadata: { kind: 'cod_approved', orderId },
        });
      } catch {
        // non-blocking
      }
      return NextResponse.json({ success: true, order: forPartner(updated), job: { jobId: job.jobId, status: job.status } });
    }

    if (action === 'decline') {
      if (order.status !== 'pending_cod_approval') {
        return NextResponse.json({ success: false, error: `Cannot decline order in status ${order.status}` }, { status: 409 });
      }
      const why = reason || 'Shop declined Cash on Pickup for this order';
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending_cod_approval', paymentMethod: 'cod', ...ownedBy },
        {
          $set: {
            status: 'cancelled',
            paymentStatus: 'failed',
            'cod.rejectedAt': now,
            'cod.rejectedReason': why,
          },
        },
        { returnDocument: 'after' }
      ).lean<Record<string, any> | null>();
      if (!updated) {
        return NextResponse.json({ success: false, error: 'Order changed meanwhile' }, { status: 409 });
      }

      try {
        const conv = await ensureOrderConversation({ orderId });
        await Conversation.updateOne({ conversationId: conv.conversationId }, { $set: { codApprovalStatus: 'rejected' } });
        await appendChatMessage({
          conversationId: conv.conversationId,
          senderType: 'system',
          senderId: partnerIdStr,
          senderName: partnerName,
          body: `❌ Cash on Pickup declined: ${why}. You can still place an online Razorpay order.`,
          metadata: { kind: 'cod_declined', orderId },
        });
      } catch {
        // non-blocking
      }
      return NextResponse.json({ success: true, order: forPartner(updated) });
    }

    if (action === 'no_show') {
      if (['completed', 'cancelled', 'refunded'].includes(order.status)) {
        return NextResponse.json({ success: false, error: `Order is already ${order.status}` }, { status: 409 });
      }
      const why = reason || 'Customer did not collect COD order';
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: { $nin: ['completed', 'cancelled', 'refunded'] }, ...ownedBy },
        {
          $set: {
            status: 'cancelled',
            paymentStatus: 'failed',
            'cod.rejectedAt': now,
            'cod.rejectedReason': why,
            'cod.noShowMarkedAt': now,
          },
        },
        { returnDocument: 'after' }
      ).lean<Record<string, any> | null>();
      if (!updated) {
        return NextResponse.json({ success: false, error: 'Order changed meanwhile' }, { status: 409 });
      }

      const job = await PrintJob.findOneAndUpdate(
        { orderId, status: { $nin: ['cancelled', 'printed'] } },
        {
          $set: { status: 'cancelled' },
          $unset: { claim: '', acceptBy: '', refundBy: '' },
          $inc: { version: 1 },
          $push: { history: { at: now, type: 'cancelled', actor: `partner:${partnerIdStr}`, detail: 'COD no-show' } },
        },
        { returnDocument: 'after' }
      ).lean<{ partnerId?: string } | null>();
      if (job?.partnerId) await announce(job as never, job.partnerId, 'cancelled').catch(() => undefined);

      const email = String(order.customerInfo?.email || '').toLowerCase();
      if (email) {
        await User.updateOne(
          { email },
          { $inc: { failedCodCount: 1 }, $set: { codBlocked: true } }
        );
      }

      try {
        const conv = await ensureOrderConversation({ orderId });
        await Conversation.updateOne({ conversationId: conv.conversationId }, { $set: { codApprovalStatus: 'rejected', status: 'resolved' } });
        await appendChatMessage({
          conversationId: conv.conversationId,
          senderType: 'system',
          senderId: partnerIdStr,
          senderName: partnerName,
          body: `⚠️ Order #${orderId} marked as COD no-show. Future Cash on Pickup orders are disabled for this account.`,
          metadata: { kind: 'cod_no_show', orderId },
        });
      } catch {
        // non-blocking
      }

      return NextResponse.json({ success: true, order: forPartner(updated) });
    }

    // mark_collected (partner counter fallback)
    if (!['printed', 'ready_for_pickup'].includes(order.status)) {
      return NextResponse.json({ success: false, error: 'Order must be printed or ready for pickup first' }, { status: 409 });
    }
    const collectedTotal = order.pricing?.total ?? order.amount;
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: { $in: ['printed', 'ready_for_pickup'] }, ...ownedBy },
      {
        $set: {
          status: 'completed',
          orderStatus: 'completed',
          paymentStatus: 'completed',
          amountPaid: collectedTotal,
          paidAt: now,
          'cod.cashCollectedAt': now,
          'cod.cashCollectedBy': `partner:${partnerIdStr}`,
        },
      },
      { returnDocument: 'after' }
    ).lean<Record<string, any> | null>();

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Order changed meanwhile' }, { status: 409 });
    }

    try {
      const conv = await ensureOrderConversation({ orderId });
      await appendChatMessage({
        conversationId: conv.conversationId,
        senderType: 'system',
        senderId: partnerIdStr,
        senderName: partnerName,
        body: `✅ Shop confirmed cash payment of ₹${collectedTotal} and marked order #${orderId} Collected.`,
        metadata: { kind: 'cod_collected_manual', orderId },
      });
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, order: forPartner(updated) });
  } catch (error) {
    console.error('Error handling COD action:', error);
    return NextResponse.json({ success: false, error: 'COD action failed' }, { status: 500 });
  }
}

