import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';

// GET Partner Profile
export async function GET(request: NextRequest) {
  try {
    let userId;
    const session = await getServerSession(authOptions);

    if (session && session.user) {
      userId = (session.user as any).id;
    } else {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const payload = Buffer.from(token.split('.')[1], 'base64').toString('utf8');
          userId = JSON.parse(payload).partnerId || JSON.parse(payload).sub;
        } catch (e) {
          console.error("Token decode error:", e);
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const partner = await Partner.findOne({ userId: userId });

    if (!partner) {
      return NextResponse.json({ success: true, partner: null });
    }

    return NextResponse.json({ success: true, partner });
  } catch (error) {
    console.error('Error fetching partner profile:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// CREATE / UPDATE Partner Profile
export async function POST(request: NextRequest) {
  try {
    let userId;
    const session = await getServerSession(authOptions);

    if (session && session.user) {
      userId = (session.user as any).id;
    } else {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const payload = Buffer.from(token.split('.')[1], 'base64').toString('utf8');
          userId = JSON.parse(payload).partnerId || JSON.parse(payload).sub;
        } catch (e) {
          console.error("Token decode error:", e);
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();

    await connectDB();

    let partner = await Partner.findOne({ userId: userId });

    if (partner) {
      // Update existing
      partner.businessName = data.businessName || partner.businessName;
      partner.razorpayAccountId = data.razorpayAccountId || partner.razorpayAccountId;

      if (data.location) {
        partner.location = data.location;
        partner.address = data.address;
      }
      if (data.servicesOffered) {
        partner.servicesOffered = { ...partner.servicesOffered, ...data.servicesOffered };
      }
      if (data.pricing) {
        partner.pricing = data.pricing;
      }
      if (data.deliveryPoints) {
        partner.deliveryPoints = data.deliveryPoints;
      }

      // Update status if provided
      if (typeof data.isOnline !== 'undefined') partner.isOnline = data.isOnline;
      if (typeof data.isActive !== 'undefined') partner.isActive = data.isActive;
      if (typeof data.phoneNumbers !== 'undefined') partner.phoneNumbers = data.phoneNumbers;

      await partner.save();
    } else {
      // Create new
      if (!data.businessName || !data.location || !data.address) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      partner = new Partner({
        userId: userId,
        businessName: data.businessName,
        razorpayAccountId: data.razorpayAccountId,
        location: data.location,
        address: data.address,
        isActive: true,
        isOnline: false,
        earnings: { totalRevenue: 0, pendingPayout: 0 },
        servicesOffered: data.servicesOffered || { printing: true, binding: false, cashOnDelivery: false },
        pricing: data.pricing || { perPageBW: 5, perPageColor: 10, binding: 40 },
        deliveryPoints: data.deliveryPoints || [],
        phoneNumbers: data.phoneNumbers || []
      });

      await partner.save();
    }

    return NextResponse.json({ success: true, partner });
  } catch (error) {
    console.error('Error saving partner profile:', error);
    return NextResponse.json({ success: false, error: 'Failed to save profile' }, { status: 500 });
  }
}
