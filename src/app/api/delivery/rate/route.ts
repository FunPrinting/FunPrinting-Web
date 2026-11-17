import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryQuote, isValidPincode } from '@/lib/delivery/rates';

/**
 * GET /api/delivery/rate?delivery_pincode=...&weight=...&pickup_pincode=...
 *
 * Delivery speed tiers (standard, express, sameday) with prices. Checkout uses the
 * same calculation (src/lib/delivery/rates.ts) for the amount actually charged.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deliveryPincode = searchParams.get('delivery_pincode');
  const weight = Number(searchParams.get('weight'));
  const pickupPincode = searchParams.get('pickup_pincode') || undefined;

  if (!deliveryPincode || !searchParams.get('weight')) {
    return NextResponse.json({ error: 'Missing required params: delivery_pincode, weight' }, { status: 400 });
  }
  if (!isValidPincode(deliveryPincode) || (pickupPincode && !isValidPincode(pickupPincode))) {
    return NextResponse.json({ error: 'Invalid pincode' }, { status: 400 });
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 50) {
    return NextResponse.json({ error: 'Invalid weight value' }, { status: 400 });
  }

  try {
    const quote = await getDeliveryQuote(deliveryPincode, weight, pickupPincode);
    const standard = quote.tiers[0];
    return NextResponse.json({
      success: true,
      tiers: quote.tiers,
      source: quote.source,
      weight: quote.weight,
      // Flat cheapest tier, kept for older clients
      deliveryCharge: standard.deliveryCharge,
      estimatedDays: standard.estimatedDays,
      courierName: standard.courierName,
    });
  } catch (error) {
    console.error('Delivery rate calculation failed:', error);
    return NextResponse.json({ error: 'Failed to calculate delivery rate' }, { status: 500 });
  }
}
