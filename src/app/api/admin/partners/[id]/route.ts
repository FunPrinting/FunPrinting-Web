import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

/**
 * PATCH /api/admin/partners/[id]
 *
 * Admin-only partner approval and payout settings. Approving sets isActive, which
 * lets the partner get a device token, receive orders and appear in nearby search.
 * Deactivating also takes the partner offline; their device tokens stop working on
 * the next API call (resolvePartnerRequest checks isActive).
 */
const bodySchema = z
  .object({
    isActive: z.boolean().optional(),
    // Razorpay Route linked account id, e.g. acc_XXXXXXXXXXXXXX
    razorpayAccountId: z
      .string()
      .trim()
      .regex(/^acc_[A-Za-z0-9]{14}$/, 'must look like acc_XXXXXXXXXXXXXX')
      .nullable()
      .optional(),
  })
  .refine((b) => b.isActive !== undefined || b.razorpayAccountId !== undefined, {
    message: 'Nothing to update',
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const log = withRequestLogger(request, { adminId: admin.id });

  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid partner id' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
      { status: 400 }
    );
  }

  try {
    await connectDB();
    const update: Record<string, unknown> = {};
    if (parsed.data.isActive !== undefined) {
      update.isActive = parsed.data.isActive;
      if (!parsed.data.isActive) update.isOnline = false;
    }
    if (parsed.data.razorpayAccountId !== undefined) {
      update.razorpayAccountId = parsed.data.razorpayAccountId ?? undefined;
    }

    const partner = await Partner.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!partner) {
      return NextResponse.json({ success: false, error: 'Partner not found' }, { status: 404 });
    }
    if (parsed.data.isActive === false) {
      const { revokeAllDevices } = await import('@/lib/partnerAuth/service');
      const revoked = await revokeAllDevices(id, `partner deactivated by ${admin.email}`);
      log.info({ partnerId: id, revoked }, 'partner devices signed out');
    }
    if (parsed.data.isActive === true && partner.delivery?.courier?.enabled && !partner.delivery.courier.pickupName) {
      after(async () => {
        const { ensureCourierPickup } = await import('@/lib/delivery/options');
        const result = await ensureCourierPickup(id).catch((err: unknown) => ({ ok: false, error: String(err) }));
        if (!result.ok) log.warn({ partnerId: id, error: result.error }, 'courier pickup not registered');
      });
    }
    log.info({ partnerId: id, changes: Object.keys(update) }, 'partner updated by admin');
    return NextResponse.json({ success: true, partner });
  } catch (error) {
    log.error({ err: error, partnerId: id }, 'partner update failed');
    return NextResponse.json({ success: false, error: 'Failed to update partner' }, { status: 500 });
  }
}
