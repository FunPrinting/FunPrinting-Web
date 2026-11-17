import { NextRequest, NextResponse, after } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { checkPartnerTarget, checkPartnerTransition } from '@/lib/partnerOrderTransitions';
import { syncJobFromOrderStatus } from '@/lib/jobs/service';
import { withRequestLogger } from '@/lib/logger';
import Order from '@/models/Order';

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
      return NextResponse.json({ success: true, order, unchanged: true });
    }

    const check = checkPartnerTransition(order, status);
    if (!check.ok) {
      return NextResponse.json({ success: false, error: check.error }, { status: 400 });
    }

    // Conditional on the status we validated against, so two concurrent updates
    // (e.g. desktop and mobile) cannot both apply. Payment fields are never touched.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status, ...ownedBy },
      { $set: { status, orderStatus: status } },
      { new: true }
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
    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    log.error({ err: error }, 'partner order status update failed');
    return NextResponse.json({ success: false, error: 'Failed to update order status' }, { status: 500 });
  }
}
