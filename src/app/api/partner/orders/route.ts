import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function GET(request: NextRequest) {
  try {
    let userId;
    const session = await getServerSession(authOptions);
    
    if (session && session.user) {
      userId = (session.user as any).id;
    } else {
      // Allow fallback to Bearer token for Desktop/Mobile Apps
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const base64Payload = token.split('.')[1];
          const payload = Buffer.from(base64Payload, 'base64').toString('utf8');
          const parsed = JSON.parse(payload);
          userId = parsed.userId || parsed.id || parsed.sub || parsed.partnerId;
        } catch (e) {
          console.error("Token decode error:", e);
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // First find the partner associated with this user
    const partner = await Partner.findOne({ userId });
    if (!partner) {
      return NextResponse.json({ success: false, error: 'Partner profile not found' }, { status: 404 });
    }

    // Get query params for filtering
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    
    // Build query
    const query: any = { 
      $or: [
        { partnerId: partner._id.toString() },
        { 'deliveryOption.partnerId': partner._id.toString() }
      ]
    };
    if (status !== 'all') {
      query.status = status;
    }

    // Fetch orders
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ success: true, count: orders.length, orders });
  } catch (error) {
    console.error('Error fetching partner orders:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch partner orders' }, { status: 500 });
  }
}
