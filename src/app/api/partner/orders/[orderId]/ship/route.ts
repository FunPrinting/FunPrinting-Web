import { NextRequest, NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { bookCourier, CourierError } from '@/lib/delivery/courier';
import { forPartner } from '@/lib/partnerOrderView';
import { withRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/partner/orders/[orderId]/ship — the shop books the courier pickup for a
 * printed courier-delivery order. The courier collects from the shop's address.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const log = withRequestLogger(request);
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const partnerId = resolved.partner._id.toString();
    const { orderId } = await params;
    const actor = resolved.deviceId ? `device:${resolved.deviceId}` : `partner:${partnerId}`;
    const result = await bookCourier(orderId, actor, { partnerId });
    return NextResponse.json({
      success: true,
      awbCode: result.awbCode,
      courierName: result.courierName,
      trackingUrl: result.trackingUrl,
      order: result.order ? forPartner(result.order) : undefined,
    });
  } catch (error) {
    if (error instanceof CourierError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    log.error({ err: error }, 'partner courier booking failed');
    return NextResponse.json({ success: false, error: 'Could not book the courier. Please try again.' }, { status: 500 });
  }
}
