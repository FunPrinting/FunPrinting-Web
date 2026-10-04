import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import jwt from 'jsonwebtoken';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = (session.user as any).role;
    if (role !== 'partner' && role !== 'admin') {
      return NextResponse.json({ error: 'Only partners can access the desktop app' }, { status: 403 });
    }

    const partnerId = (session.user as any).id;
    const secret = process.env.NEXTAUTH_SECRET || 'fallback-secret-for-development';

    // Sign a raw JWT token that the WebSocket server (wss/index.js) can read
    const token = jwt.sign(
      { sub: partnerId, partnerId, role },
      secret,
      { expiresIn: '365d' } // Long-lived token for desktop app
    );

    return NextResponse.json({ success: true, partnerId, token });
  } catch (error) {
    console.error('Error generating desktop token:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
