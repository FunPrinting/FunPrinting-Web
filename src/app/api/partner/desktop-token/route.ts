import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import jwt from 'jsonwebtoken';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Partner from '@/models/Partner';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let role = (session.user as any).role;
    let partnerId = (session.user as any).id;
    
    await connectDB();

    // Resiliency: If partnerId is a legacy Google Provider ID instead of a valid MongoDB ObjectId
    const isValidHex = /^[0-9a-fA-F]{24}$/.test(partnerId);
    if (!partnerId || !isValidHex) {
      const dbUser = await User.findOne({ email: session.user.email });
      if (dbUser) {
        partnerId = dbUser._id.toString();
        role = dbUser.role;
      } else {
        return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
      }
    }
    
    if (role !== 'partner' && role !== 'admin') {
      // Auto-upgrade user to partner when they log in via the app
      await User.findByIdAndUpdate(partnerId, { role: 'partner' });
      role = 'partner';
      console.log(`User ${partnerId} auto-upgraded to partner.`);
    }

    // Ensure they have a formal Partner document so they appear on the Admin Dashboard
    const existingPartner = await Partner.findOne({ userId: partnerId });
    if (!existingPartner && role === 'partner') {
      const userDoc = await User.findById(partnerId);
      await Partner.create({
        userId: partnerId,
        businessName: userDoc?.name ? `${userDoc.name}'s Print Shop` : 'New Franchise Partner',
        isActive: true,
        isOnline: false,
        servicesOffered: { printing: true, binding: false, cashOnDelivery: true },
        earnings: { totalRevenue: 0, pendingPayout: 0 }
      });
      console.log(`Created new Partner profile for ${partnerId}`);
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
