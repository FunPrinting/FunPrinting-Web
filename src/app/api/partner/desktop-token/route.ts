import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Partner from '@/models/Partner';
import { getSessionUser } from '@/lib/authz';

/**
 * GET /api/partner/desktop-token
 *
 * Issues a device token for the partner desktop/mobile apps.
 * Only existing partners get a token: users are never auto-upgraded and Partner
 * documents are never created here.
 *
 * Token claims: { sub: User._id, partnerId: Partner._id, role, typ: 'partner_device' }.
 * The WSS joins room partner_<partnerId>, which matches the Partner._id stored on orders.
 */
export async function GET() {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('❌ NEXTAUTH_SECRET is not set; cannot issue partner device tokens');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    await connectDB();

    // Resolve the DB user (session id may be a legacy provider id)
    const isValidHex = /^[0-9a-fA-F]{24}$/.test(sessionUser.id);
    const dbUser = isValidHex
      ? await User.findById(sessionUser.id)
      : await User.findOne({ email: sessionUser.email });
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
    }

    const userId = dbUser._id.toString();
    const userRole: string = dbUser.role || 'customer';
    const partner = await Partner.findOne({ userId });

    // A token needs a Partner document (its _id is the routing key for print jobs)
    if (!partner) {
      return NextResponse.json({ error: 'not_a_partner', applyUrl: '/partner' }, { status: 403 });
    }
    // ...and that partner must be approved by an admin
    if (!partner.isActive) {
      return NextResponse.json({ error: 'partner_pending_approval', applyUrl: '/partner/dashboard' }, { status: 403 });
    }

    const role: 'partner' | 'admin' = userRole === 'admin' ? 'admin' : 'partner';
    const partnerId = partner._id.toString();

    const token = jwt.sign(
      { sub: userId, partnerId, role, typ: 'partner_device' },
      secret,
      { algorithm: 'HS256', expiresIn: '30d' }
    );

    return NextResponse.json({ success: true, partnerId, token });
  } catch (error) {
    console.error('Error generating desktop token:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
