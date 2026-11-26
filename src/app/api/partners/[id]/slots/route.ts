import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import { buildScheduleCalendar, type ScheduleSlotTemplate, type ScheduleTarget } from '@/lib/scheduling';
import { getBookedSlotCounts } from '@/lib/schedulingServer';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * GET /api/partners/[id]/slots?target=store|pickup_point&pickupPoint=...
 * Returns the 7-day Apple-style day & time-slot calendar for a partner shop or pickup point.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!OBJECT_ID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'Invalid shop id' }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const targetParam = sp.get('target');
    const target: ScheduleTarget = targetParam === 'pickup_point' ? 'pickup_point' : 'store';
    const pickupPoint = sp.get('pickupPoint') || undefined;

    await connectDB();
    const partner = await Partner.findOne({ _id: id, isActive: true })
      .select('businessName scheduleSlots')
      .lean<{ businessName?: string; scheduleSlots?: ScheduleSlotTemplate[] } | null>();

    if (!partner) {
      return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });
    }

    const bookedCounts = await getBookedSlotCounts(id, { target, days: 8 });
    const days = buildScheduleCalendar({
      partnerSlots: partner.scheduleSlots,
      target,
      pickupPointName: pickupPoint,
      bookedCounts,
      daysCount: 7,
    });

    return NextResponse.json({
      success: true,
      target,
      pickupPoint: pickupPoint || null,
      timezone: 'Asia/Kolkata',
      days,
    });
  } catch (error) {
    console.error('Error fetching partner slots:', error);
    return NextResponse.json({ success: false, error: 'Failed to load available time slots' }, { status: 500 });
  }
}
