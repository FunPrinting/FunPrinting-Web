import { NextRequest, NextResponse, after } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { checkPartnerTarget, checkPartnerTransition, STATUS_RANK } from '@/lib/partnerOrderTransitions';
import { releasePartnerTransfer } from '@/lib/payments/refunds';
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
    // The partner's Route share is held until the job is printed
    if (updated.paymentRef && STATUS_RANK[status] >= STATUS_RANK.printed) {
      const ref = String(updated.paymentRef);
      after(() =>
        releasePartnerTransfer(ref)
          .then((r) => log.info({ referenceId: ref, result: r }, 'partner transfer release'))
          .catch((err) => log.error({ err, referenceId: ref }, 'partner transfer release failed'))
      );
    }
    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    log.error({ err: error }, 'partner order status update failed');
    return NextResponse.json({ success: false, error: 'Failed to update order status' }, { status: 500 });
  }
}
