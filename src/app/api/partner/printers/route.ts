import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePartnerRequest } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import PartnerDevice from '@/models/PartnerDevice';

export const runtime = 'nodejs';

const body = z.object({
  printers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        color: z.boolean(),
        duplex: z.boolean(),
        a3: z.boolean(),
      })
    )
    .max(20),
});

/** PATCH /api/partner/printers: the desktop app reports the printers it prints on (enabled ones). */
export async function PATCH(request: NextRequest) {
  const resolved = await resolvePartnerRequest(request, { allowInactive: true });
  if (resolved instanceof NextResponse) return resolved;
  if (!resolved.deviceId) return NextResponse.json({ success: false, error: 'Only a signed-in app can report printers' }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid printer list' }, { status: 400 });
  await connectDB();
  const res = await PartnerDevice.updateOne(
    { deviceId: resolved.deviceId, partnerId: String(resolved.partner._id), revokedAt: { $exists: false } },
    { $set: { printers: parsed.data.printers, printersReportedAt: new Date() } }
  );
  if (!res.matchedCount) return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
