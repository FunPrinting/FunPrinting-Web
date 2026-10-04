import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import jwt from 'jsonwebtoken';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let role = (session.user as any).role;
    const partnerId = (session.user as any).id;
    
    if (role !== 'partner' && role !== 'admin') {
      // Auto-upgrade user to partner when they log in via the app
      await connectDB();
      await User.findByIdAndUpdate(partnerId, { role: 'partner' });
      role = 'partner';
      console.log(`User ${partnerId} auto-upgraded to partner.`);
    }

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
