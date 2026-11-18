import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import { getDeliveryOptions, type PartnerDeliveryFields } from '@/lib/delivery/options';
import { checkRateLimit, getClientIdentifier, statusRateLimit } from '@/lib/ratelimit';
import { withRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const query = z.object({
  partnerId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  pinCode: z.string().regex(/^[1-9]\d{5}$/).optional(),
  weight: z.coerce.number().positive().max(50),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * GET /api/delivery/options?partnerId=&pinCode=&weight=&lat=&lng=
 *
 * Home delivery options for one shop and address: courier tiers quoted from the
 * shop's pincode, and the shop's own delivery if it offers it and the customer is
 * inside its radius. Checkout runs the same check (src/lib/delivery/options.ts).
 */
export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(statusRateLimit, `delivery-options:${getClientIdentifier(request)}`);
  if (limited) return limited;

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid delivery details' }, { status: 400 });
  const { partnerId, pinCode, weight, lat, lng } = parsed.data;

  const log = withRequestLogger(request);
  try {
    await connectDB();
    const partner = await Partner.findOne({ _id: partnerId, isActive: true })
      .select('location address delivery')
      .lean<PartnerDeliveryFields | null>();
    if (!partner) return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });

    const location = lat !== undefined && lng !== undefined ? { lat, lng } : null;
    const options = await getDeliveryOptions(partner, { pinCode, weightKg: weight, location });
    return NextResponse.json({ success: true, ...options });
  } catch (error) {
    log.error({ err: error, partnerId }, 'delivery options failed');
    return NextResponse.json({ success: false, error: 'Could not check delivery options. Please try again.' }, { status: 502 });
  }
}
