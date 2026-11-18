import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { bookCourier, CourierError } from '@/lib/delivery/courier';
import { withRequestLogger } from '@/lib/logger';

/**
 * POST /api/admin/orders/[id]/ship — book the Shiprocket courier for a courier-delivery
 * order, from the shop's own pickup address. Same logic the shop's apps use.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const log = withRequestLogger(request);
  try {
    await connectDB();
    const { id } = await context.params;
    const ref = /^[0-9a-fA-F]{24}$/.test(id) ? await Order.findById(id).select('orderId').lean<{ orderId: string } | null>() : { orderId: id };
    if (!ref) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

    const result = await bookCourier(ref.orderId, `admin:${auth.email}`);
    return NextResponse.json({ success: true, message: `Courier booked: ${result.courierName}, AWB ${result.awbCode}`, shiprocket: result, order: result.order });
  } catch (error) {
    if (error instanceof CourierError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    log.error({ err: error }, 'admin courier booking failed');
    return NextResponse.json({ success: false, error: 'Could not book the courier' }, { status: 500 });
  }
}
