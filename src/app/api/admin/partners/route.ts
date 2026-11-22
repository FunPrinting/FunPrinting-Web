import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import PartnerDevice from '@/models/PartnerDevice';

/** GET /api/admin/partners: every shop, newest first, with its signed-in devices and their app versions. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    await connectDB();
    const [partners, devices] = await Promise.all([
      Partner.find({}).sort({ createdAt: -1 }).lean<Array<Record<string, any>>>(),
      PartnerDevice.find({ revokedAt: { $exists: false } })
        .select('deviceId partnerId name platform appVersion lastSeenAt printers')
        .sort({ lastSeenAt: -1 })
        .lean<Array<{ deviceId: string; partnerId: string; name: string; platform: string; appVersion?: string; lastSeenAt?: Date; printers?: Array<{ name: string; color: boolean; duplex: boolean; a3: boolean }> }>>(),
    ]);
    const byPartner = new Map<string, typeof devices>();
    for (const d of devices) {
      const list = byPartner.get(String(d.partnerId)) ?? [];
      list.push(d);
      byPartner.set(String(d.partnerId), list);
    }
    return NextResponse.json({
      success: true,
      count: partners.length,
      partners: partners.map((p) => ({
        ...p,
        devices: (byPartner.get(String(p._id)) ?? []).map(({ deviceId, name, platform, appVersion, lastSeenAt, printers }) => ({ deviceId, name, platform, appVersion, lastSeenAt, printers })),
      })),
    });
  } catch (error) {
    console.error('Error fetching admin partners:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch partners' }, { status: 500 });
  }
}
