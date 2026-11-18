import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { STATUS_RANK } from '@/lib/partnerOrderTransitions';
import { withRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/courier-updates — Shiprocket shipment tracking updates.
 *
 * Set up in Shiprocket: Settings → API → Webhooks, URL https://<site>/api/webhooks/courier-updates
 * and the security token = SHIPROCKET_WEBHOOK_TOKEN (sent as x-api-key). Shiprocket's
 * rules forbid "shiprocket", "sr", "kr" in the URL, hence the name.
 *
 * Stores the latest status and marks the order delivered when the courier delivers it.
 */
function tokenOk(given: string | null): boolean {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const log = withRequestLogger(request);
  if (!tokenOk(request.headers.get('x-api-key'))) {
    log.warn('courier webhook with a bad or missing token');
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const awb = body?.awb ? String(body.awb).slice(0, 40) : '';
  const status = String(body?.current_status || body?.shipment_status || '').toUpperCase().slice(0, 60);
  if (!awb || !status) return NextResponse.json({ ok: true, ignored: 'no awb or status' });
  if (Number(body?.is_return) === 1) {
    // Return-to-shop shipments: record only, an admin handles the refund question
    log.warn({ awb, status }, 'courier return shipment update');
  }

  try {
    await connectDB();
    const order = await Order.findOne({ 'shiprocket.awbCode': awb }).select('orderId status').lean<{ _id: unknown; orderId: string; status: string } | null>();
    if (!order) return NextResponse.json({ ok: true, ignored: 'unknown awb' });

    const set: Record<string, unknown> = { 'shiprocket.status': status, 'shiprocket.lastTrackedAt': new Date() };
    const delivered = status === 'DELIVERED' && Number(body?.is_return) !== 1;
    if (delivered && (STATUS_RANK[order.status] ?? 99) < STATUS_RANK.delivered) {
      set.status = 'delivered';
      set.orderStatus = 'delivered';
    }
    await Order.updateOne({ _id: order._id }, { $set: set });
    log.info({ orderId: order.orderId, status, delivered }, 'courier status updated');
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ err: error, awb }, 'courier webhook failed');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
