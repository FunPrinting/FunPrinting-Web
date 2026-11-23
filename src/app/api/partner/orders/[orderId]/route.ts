import { NextRequest, NextResponse, after } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { checkPartnerTarget, checkPartnerTransition, MAX_HANDOVER_ATTEMPTS } from '@/lib/partnerOrderTransitions';
import { forPartner } from '@/lib/partnerOrderView';
import { timingSafeEqual } from 'node:crypto';
import { syncJobFromOrderStatus } from '@/lib/jobs/service';
import { withRequestLogger } from '@/lib/logger';
import Order from '@/models/Order';

/**
 * GET /api/partner/orders/[orderId] — one of the shop's orders. The desktop app
 * uses it for the order summary sheet it prints on top of a job.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const log = withRequestLogger(request);
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const partnerIdStr = resolved.partner._id.toString();
    const { orderId } = await params;
    const order = await Order.findOne({
      orderId,
      $or: [{ partnerId: partnerIdStr }, { 'deliveryOption.partnerId': partnerIdStr }],
    }).lean();
    if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    return NextResponse.json({ success: true, order: forPartner(order) });
  } catch (error) {
    log.error({ err: error }, 'partner order fetch failed');
    return NextResponse.json({ success: false, error: 'Failed to fetch order' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const log = withRequestLogger(request);
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const { partner } = resolved;

    const body = await request.json().catch(() => null);
    const status = body?.status;
    const targetCheck = checkPartnerTarget(status);
    if (!targetCheck.ok) {
      return NextResponse.json({ success: false, error: targetCheck.error }, { status: 400 });
    }

    const { orderId } = await params;
    const partnerIdStr = partner._id.toString();
    const ownedBy = {
      $or: [{ partnerId: partnerIdStr }, { 'deliveryOption.partnerId': partnerIdStr }],
    };

    const order = await Order.findOne({ orderId, ...ownedBy });
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found or unauthorized' }, { status: 404 });
    }

    // Repeating the current status (reprint, double click, desktop auto-update) is a no-op
    if (order.status === status) {
      return NextResponse.json({ success: true, order: forPartner(order), unchanged: true });
    }

    const check = checkPartnerTransition(order, status);
    if (!check.ok) {
      return NextResponse.json({ success: false, error: check.error }, { status: 400 });
    }

    // Shop delivery: the customer's handover code proves the order was handed over
    let verifiedNow = false;
    if (check.needsHandoverCode) {
      const handover = order.deliveryOption?.handover;
      const given = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : '';
      if (!handover?.code) {
        return NextResponse.json({ success: false, error: 'This order has no handover code. Please contact support.' }, { status: 409 });
      }
      if ((handover.attempts ?? 0) >= MAX_HANDOVER_ATTEMPTS) {
        return NextResponse.json({ success: false, error: 'Too many wrong codes. Contact support to confirm the delivery.', code: 'handover_locked' }, { status: 423 });
      }
      if (!given) {
        return NextResponse.json({ success: false, error: 'Ask the customer for their 4-digit delivery code', code: 'handover_required' }, { status: 400 });
      }
      const ok = given.length === handover.code.length && timingSafeEqual(Buffer.from(given), Buffer.from(handover.code));
      if (!ok) {
        const bumped = await Order.findOneAndUpdate(
          { _id: order._id },
          { $inc: { 'deliveryOption.handover.attempts': 1 } },
          { returnDocument: 'after', projection: { 'deliveryOption.handover.attempts': 1 } }
        ).lean<{ deliveryOption?: { handover?: { attempts?: number } } }>();
        const left = Math.max(0, MAX_HANDOVER_ATTEMPTS - (bumped?.deliveryOption?.handover?.attempts ?? MAX_HANDOVER_ATTEMPTS));
        log.warn({ orderId, partnerId: partnerIdStr, left }, 'wrong handover code');
        return NextResponse.json(
          { success: false, error: left ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Contact support to confirm the delivery.', code: left ? 'handover_wrong' : 'handover_locked', attemptsLeft: left },
          { status: 400 }
        );
      }
      verifiedNow = true;
    }

    // Conditional on the status we validated against, so two concurrent updates
    // (e.g. desktop and mobile) cannot both apply. Payment fields are never touched.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status, ...ownedBy },
      { $set: { status, orderStatus: status, ...(verifiedNow ? { 'deliveryOption.handover.verifiedAt': new Date() } : {}) } },
      { returnDocument: 'after' }
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Order changed meanwhile; reload and try again' },
        { status: 409 }
      );
    }

    log.info({ orderId, partnerId: partnerIdStr, from: order.status, to: status }, 'partner order status updated');
    // Keep the print job in step; reaching "printed" also releases the held partner share
    const label = `partner:${partnerIdStr}`;
    after(() =>
      syncJobFromOrderStatus(orderId, status, label).catch((err) => log.error({ err, orderId }, 'job sync failed'))
    );
    return NextResponse.json({ success: true, order: forPartner(updated) });
  } catch (error) {
    log.error({ err: error }, 'partner order status update failed');
    return NextResponse.json({ success: false, error: 'Failed to update order status' }, { status: 500 });
  }
}
