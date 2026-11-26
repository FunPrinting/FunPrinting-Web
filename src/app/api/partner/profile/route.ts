import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { resolvePartnerRequest } from '@/lib/authz';
import { ensureCourierPickup } from '@/lib/delivery/options';
import { scheduleSlotsArraySchema } from '@/lib/scheduling';
import Partner from '@/models/Partner';

/** Home delivery settings a shop controls (docs/DELIVERY.md). */
const deliverySettings = z.object({
  courier: z.object({ enabled: z.boolean() }).optional(),
  self: z
    .object({
      enabled: z.boolean(),
      radiusKm: z.number().min(0.5, 'Delivery radius must be at least 0.5 km').max(25, 'Delivery radius can be at most 25 km').optional(),
      fee: z.number().int('Use a whole-rupee fee').min(0).max(1000, 'Delivery fee can be at most ₹1,000').optional(),
      etaMinutes: z.number().int().min(15).max(24 * 60).optional(),
    })
    .optional(),
});

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
        const moved = JSON.stringify(partner.address ?? {}) !== JSON.stringify(data.address ?? {});
        partner.location = data.location;
        partner.address = data.address;
        // Couriers collect from the address: a new address needs a new pickup registration
        if (moved && partner.delivery?.courier?.pickupName) {
          partner.set('delivery.courier.pickupName', undefined);
          partner.set('delivery.courier.registeredAt', undefined);
        }
      }
      if (data.delivery !== undefined) {
        const parsed = deliverySettings.safeParse(data.delivery);
        if (!parsed.success) {
          return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid delivery settings' }, { status: 400 });
        }
        const { courier, self } = parsed.data;
        if (courier) partner.set('delivery.courier.enabled', courier.enabled);
        if (self) {
          partner.set('delivery.self.enabled', self.enabled);
          if (self.radiusKm !== undefined) partner.set('delivery.self.radiusKm', self.radiusKm);
          if (self.fee !== undefined) partner.set('delivery.self.fee', self.fee);
          if (self.etaMinutes !== undefined) partner.set('delivery.self.etaMinutes', self.etaMinutes);
        }
      }
      if (data.servicesOffered) {
        partner.servicesOffered = { ...partner.servicesOffered, ...data.servicesOffered };
        partner.markModified('servicesOffered');
      }
      if (data.pricing) {
        partner.pricing = data.pricing;
      }
      if (data.deliveryPoints) {
        partner.deliveryPoints = data.deliveryPoints;
      }
      if (data.scheduleSlots !== undefined) {
        const parsedSlots = scheduleSlotsArraySchema.safeParse(data.scheduleSlots);
        if (!parsedSlots.success) {
          return NextResponse.json(
            { success: false, error: parsedSlots.error.issues[0]?.message || 'Invalid time slots' },
            { status: 400 }
          );
        }
        partner.scheduleSlots = parsedSlots.data;
        partner.markModified('scheduleSlots');
      }

      // Online/offline is the partner's choice, but only once approved.
      // isActive (approval) is set by an admin only and is ignored here.
      if (typeof data.isOnline === 'boolean') partner.isOnline = partner.isActive ? data.isOnline : false;
      if (typeof data.phoneNumbers !== 'undefined') partner.phoneNumbers = data.phoneNumbers;
      // auto: paid orders go straight to the print queue; manual: the shop accepts each one
      if (data.acceptanceMode === 'auto' || data.acceptanceMode === 'manual') partner.acceptanceMode = data.acceptanceMode;

      await partner.save();
      // Register the shop's courier pickup address in the background once it is needed
      if (partner.isActive && partner.delivery?.courier?.enabled && !partner.delivery.courier.pickupName) {
        const id = String(partner._id);
        after(() => ensureCourierPickup(id).then(() => undefined, (err) => console.error('courier pickup registration failed', err)));
      }
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
        servicesOffered: data.servicesOffered || {
          printing: { enabled: true, maxPaperSize: 'a4', supportsColor: true, supportsBlackAndWhite: true, supportsDoubleSided: false },
          binding: { enabled: false, types: { spiral: false, perfect: false, staple: false } },
        },
        pricing: data.pricing || { perPageBW: 2, perPageColor: 5, binding: { spiral: 30, perfect: 50, staple: 10 } },
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
