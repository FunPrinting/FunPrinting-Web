import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { logOrderEvent } from '@/lib/orderUtils';
import { STATUS_RANK } from '@/lib/partnerOrderTransitions';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    const { id } = await context.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { orderId: id };
    const order = await Order.findOne(query);
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Convert Mongoose document to plain object to ensure all fields are serialized
    const orderData = order.toObject ? order.toObject() : order;

    // Ensure array fields are always present to avoid client-side crashes
    orderData.fileURLs = Array.isArray(orderData.fileURLs) ? orderData.fileURLs : [];
    orderData.originalFileNames = Array.isArray(orderData.originalFileNames) ? orderData.originalFileNames : [];

    // The shop that prints it (same fields the customer's order page shows)
    let partnerInfo = null;
    const partnerId = orderData.partnerId || orderData.deliveryOption?.partnerId;
    if (partnerId && /^[0-9a-fA-F]{24}$/.test(String(partnerId))) {
      const partner = await Partner.findById(partnerId).select('businessName phoneNumbers deliveryPoints address').lean();
      if (partner) partnerInfo = partner;
    }

    return NextResponse.json({
      success: true,
      order: { ...orderData, partnerInfo },
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/orders/[id] with { status }: set where a paid order is in fulfilment.
 * Admins may move in either direction to correct a mistake; payment states
 * (pending_payment, cancelled, refunded) are changed only by payments and the job's cancel action.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const target = typeof body?.status === 'string' ? body.status : '';

    if (!target || target === 'paid' || STATUS_RANK[target] === undefined) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Use one of: ${Object.keys(STATUS_RANK).filter((s) => s !== 'paid').join(', ')}` },
        { status: 400 }
      );
    }

    const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { orderId: id };
    const current = await Order.findOne(query).select('orderId status paymentStatus');
    if (!current) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (current.paymentStatus !== 'completed' || STATUS_RANK[current.status] === undefined) {
      return NextResponse.json(
        { success: false, error: `An order that is "${current.status}" cannot be moved through fulfilment` },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { status: target, orderStatus: target, updatedAt: new Date() };
    if (target === 'printed') update.printedAt = new Date();
    const order = await Order.findOneAndUpdate(query, update, { returnDocument: 'after' });
    if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

    const { syncJobFromOrderStatus } = await import('@/lib/jobs/service');
    await syncJobFromOrderStatus(order.orderId, target, `admin:${auth.email}`).catch((error) => console.error('Job sync failed:', error));

    logOrderEvent('status_updated', order.orderId, { from: current.status, to: target, updatedBy: `admin:${auth.email}` });
    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json({ success: false, error: 'Failed to update order' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    const { id } = await context.params;
    
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { orderId: id };

    const order = await Order.findOneAndDelete(query);
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Stop any print job for it (no refund here: refunds go through the job's cancel action)
    try {
      const { cancelJob } = await import('@/lib/jobs/deadlines');
      await cancelJob(order.orderId, { reason: 'Order deleted by admin', actor: `admin:${auth.email}`, refund: false, force: true });
    } catch (err) {
      console.warn(`Could not cancel the print job for deleted order ${order.orderId}:`, err);
    }

    console.log(`Order ${order.orderId} deleted successfully`);
    return NextResponse.json({
      success: true,
      message: 'Order deleted successfully',
      orderId: order.orderId,
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete order' },
      { status: 500 }
    );
  }
}
