import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import User from '@/models/User';
import { isAllowedCallback } from '@/lib/partnerAuth/callbacks';
import { DeviceAuthError, issueAuthCode } from '@/lib/partnerAuth/service';

export const runtime = 'nodejs';

const bodySchema = z.object({ codeChallenge: z.string(), callback: z.string().max(300) });

/**
 * POST /api/partner/device-auth/code — called by /partner/desktop-auth in the
 * partner's signed-in browser. Returns a one-time code (60 s) for the app.
 */
export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isAllowedCallback(parsed.data.callback)) {
    return NextResponse.json({ error: 'This sign-in link is not from a recognised Fun Printing Partner app.' }, { status: 400 });
  }

  await connectDB();
  const dbUser = /^[0-9a-fA-F]{24}$/.test(sessionUser.id)
    ? await User.findById(sessionUser.id).select('_id').lean<{ _id: unknown } | null>()
    : await User.findOne({ email: sessionUser.email }).select('_id').lean<{ _id: unknown } | null>();
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const userId = String(dbUser._id);
  const partner = await Partner.findOne({ userId }).select('_id isActive').lean<{ _id: unknown; isActive: boolean } | null>();
  if (!partner) return NextResponse.json({ error: 'not_a_partner', applyUrl: '/partner' }, { status: 403 });
  if (!partner.isActive) return NextResponse.json({ error: 'partner_pending_approval', applyUrl: '/partner/dashboard' }, { status: 403 });

  try {
    const code = await issueAuthCode({ partnerId: String(partner._id), userId, challenge: parsed.data.codeChallenge, callback: parsed.data.callback });
    return NextResponse.json({ success: true, code });
  } catch (error) {
    if (error instanceof DeviceAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
