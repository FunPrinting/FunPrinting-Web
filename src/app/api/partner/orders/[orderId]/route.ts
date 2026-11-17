import { NextRequest, NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import Order from '@/models/Order';

/**
 * Fulfilment progression a partner may move an order through.
 * Only forward moves are allowed. Targets are limited to statuses that exist in
 * both Order.status and Order.orderStatus enums.
 * ('out_for_delivery' is not in the Order enums, so it is not offered.)
 */
const STATUS_RANK: Record<string, number> = {
  paid: 0,
  processing: 1,
  printing: 2,
  printed: 3,
  ready_for_pickup: 4,
  dispatched: 5,
  delivered: 6,
  completed: 7,
};
const PARTNER_TARGET_STATUSES = new Set([
  'printing',
  'printed',
  'ready_for_pickup',
  'delivered',
  'completed',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const { partner } = resolved;

    const body = await request.json().catch(() => null);
    const status = body?.status;
    if (typeof status !== 'string' || !status) {
      return NextResponse.json({ success: false, error: 'Missing status update' }, { status: 400 });
    }
    if (!PARTNER_TARGET_STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: `Status "${status}" cannot be set by a partner` },
        { status: 400 }
      );
    }

    const { orderId } = await params;
    const partnerIdStr = partner._id.toString();

    // Find order and ensure it belongs to this partner
    const order = await Order.findOne({
      orderId,
      $or: [
        { partnerId: partnerIdStr },
        { 'deliveryOption.partnerId': partnerIdStr }
      ]
    });

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found or unauthorized' }, { status: 404 });
    }

    if (order.paymentStatus !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Order is not paid' },
        { status: 400 }
      );
    }

    const currentRank = STATUS_RANK[order.status];
    if (currentRank === undefined) {
      // pending_payment, cancelled, refunded, or unknown: partners cannot change these
      return NextResponse.json(
        { success: false, error: `Order in status "${order.status}" cannot be updated` },
        { status: 400 }
      );
    }
    if (STATUS_RANK[status] <= currentRank) {
      return NextResponse.json(
        { success: false, error: `Cannot move order from "${order.status}" to "${status}"` },
        { status: 400 }
      );
    }

    // Only the fulfilment status fields change; payment fields are never touched here
    order.status = status;
    order.orderStatus = status;
    await order.save();

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Error updating order status:', error);
    return NextResponse.json({ success: false, error: 'Failed to update order status' }, { status: 500 });
  }
}
