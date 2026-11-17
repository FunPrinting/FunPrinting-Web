import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePartnerRequest } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import PartnerDevice from '@/models/PartnerDevice';
import { revokeDevice } from '@/lib/partnerAuth/service';

export const runtime = 'nodejs';

/** GET /api/partner/devices — this shop's signed-in apps. */
export async function GET(request: NextRequest) {
  const resolved = await resolvePartnerRequest(request, { allowInactive: true });
  if (resolved instanceof NextResponse) return resolved;
  await connectDB();
  const devices = await PartnerDevice.find({ partnerId: String(resolved.partner._id), revokedAt: { $exists: false } })
    .sort({ lastSeenAt: -1 })
    .select('deviceId name platform appVersion lastSeenAt createdAt')
    .lean();
  return NextResponse.json({ success: true, devices, currentDeviceId: resolved.deviceId ?? null });
}

/** DELETE /api/partner/devices { deviceId } — sign a device out (its tokens stop working). */
export async function DELETE(request: NextRequest) {
  const resolved = await resolvePartnerRequest(request, { allowInactive: true });
  if (resolved instanceof NextResponse) return resolved;
  const parsed = z.object({ deviceId: z.string().min(4).max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'deviceId is required' }, { status: 400 });
  await connectDB();
  const owned = await PartnerDevice.exists({ deviceId: parsed.data.deviceId, partnerId: String(resolved.partner._id) });
  if (!owned) return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 });
  await revokeDevice(parsed.data.deviceId, 'signed out from the dashboard');
  return NextResponse.json({ success: true });
}
