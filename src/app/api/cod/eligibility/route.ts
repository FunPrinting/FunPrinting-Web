import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { getSessionUser } from '@/lib/authz';
import { evaluateCodEligibility, type PartnerCodConfig } from '@/lib/cod';
import Partner from '@/models/Partner';
import User from '@/models/User';

/**
 * GET /api/cod/eligibility?partnerId=...&pickupPoint=...&subtotal=...&deliveryType=pickup
 * Evaluates whether Cash on Pickup (COD) is available for the current user, shop, and order total.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const partnerId = sp.get('partnerId')?.trim() || '';
    const pickupPoint = sp.get('pickupPoint')?.trim() || undefined;
    const deliveryType = sp.get('deliveryType') === 'delivery' ? 'delivery' : 'pickup';
    const subtotal = Number(sp.get('subtotal') || '0');

    if (!/^[0-9a-fA-F]{24}$/.test(partnerId)) {
      return NextResponse.json({ success: false, error: 'Invalid partnerId' }, { status: 400 });
    }

    await connectDB();
    const partner = await Partner.findById(partnerId)
      .select('isActive cod')
      .lean<{ isActive: boolean; cod?: Partial<PartnerCodConfig> } | null>();
    if (!partner || !partner.isActive) {
      return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });
    }

    const sessionUser = await getSessionUser();
    const userDoc = sessionUser?.email
      ? await User.findOne({ email: sessionUser.email.toLowerCase() })
          .select('failedCodCount codBlocked')
          .lean<{ failedCodCount?: number; codBlocked?: boolean } | null>()
      : null;

    const result = evaluateCodEligibility({
      deliveryType,
      pickupPointName: pickupPoint,
      subtotalRupees: Number.isFinite(subtotal) ? subtotal : 0,
      partnerCod: partner.cod,
      userCodBlocked: Boolean(userDoc?.codBlocked),
      failedCodCount: userDoc?.failedCodCount ?? 0,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error checking COD eligibility:', error);
    return NextResponse.json({ success: false, error: 'Could not check COD availability' }, { status: 500 });
  }
}

