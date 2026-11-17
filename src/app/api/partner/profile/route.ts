import { NextRequest, NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import Partner from '@/models/Partner';

// GET Partner Profile
export async function GET(request: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(request, { allowMissing: true, allowInactive: true });
    if (resolved instanceof NextResponse) return resolved;

    const { partner } = resolved;

    if (!partner) {
      return NextResponse.json({ success: true, partner: null });
    }

    return NextResponse.json({ success: true, partner });
  } catch (error) {
    console.error('Error fetching partner profile:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// CREATE / UPDATE Partner Profile
export async function POST(request: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(request, { allowMissing: true, allowInactive: true });
    if (resolved instanceof NextResponse) return resolved;
    const { userId } = resolved;

    const data = await request.json();

    let partner = resolved.partner;

    if (partner) {
      // Update existing
      partner.businessName = data.businessName || partner.businessName;
      // The linked account receives the partner's payout split. A partner may set it
      // while the application is pending (the admin reviews it before approving);
      // after approval only an admin can change it (/api/admin/partners/[id]).
      if (!partner.isActive && typeof data.razorpayAccountId === 'string' && data.razorpayAccountId.trim()) {
        partner.razorpayAccountId = data.razorpayAccountId.trim();
      }

      if (data.location) {
        partner.location = data.location;
        partner.address = data.address;
      }
      if (data.servicesOffered) {
        partner.servicesOffered = { ...partner.servicesOffered, ...data.servicesOffered };
      }
      if (data.pricing) {
        partner.pricing = data.pricing;
      }
      if (data.deliveryPoints) {
        partner.deliveryPoints = data.deliveryPoints;
      }

      // Online/offline is the partner's choice, but only once approved.
      // isActive (approval) is set by an admin only and is ignored here.
      if (typeof data.isOnline === 'boolean') partner.isOnline = partner.isActive ? data.isOnline : false;
      if (typeof data.phoneNumbers !== 'undefined') partner.phoneNumbers = data.phoneNumbers;
      // auto: paid orders go straight to the print queue; manual: the shop accepts each one
      if (data.acceptanceMode === 'auto' || data.acceptanceMode === 'manual') partner.acceptanceMode = data.acceptanceMode;

      await partner.save();
    } else {
      // Create new
      if (!data.businessName || !data.location || !data.address) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      partner = new Partner({
        userId: userId,
        businessName: data.businessName,
        razorpayAccountId: typeof data.razorpayAccountId === 'string' ? data.razorpayAccountId.trim() : undefined,
        location: data.location,
        address: data.address,
        // New partners wait for admin approval before they can receive orders,
        // appear in /api/partners/nearby, or get a device token
        isActive: false,
        isOnline: false,
        earnings: { totalRevenue: 0, pendingPayout: 0 },
        servicesOffered: data.servicesOffered || { printing: true, binding: false, cashOnDelivery: false },
        pricing: data.pricing || { perPageBW: 5, perPageColor: 10, binding: 40 },
        deliveryPoints: data.deliveryPoints || [],
        phoneNumbers: data.phoneNumbers || []
      });

      await partner.save();
      const { sendPartnerApplicationEmail } = await import('@/lib/jobs/emails');
      await sendPartnerApplicationEmail({ businessName: partner.businessName, partnerId: String(partner._id), city: data.address?.city }).catch(() => undefined);
    }

    return NextResponse.json({ success: true, partner });
  } catch (error) {
    console.error('Error saving partner profile:', error);
    return NextResponse.json({ success: false, error: 'Failed to save profile' }, { status: 500 });
  }
}
