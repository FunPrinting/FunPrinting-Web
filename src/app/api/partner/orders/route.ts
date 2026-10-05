import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // First find the partner associated with this user
    const partner = await Partner.findOne({ userId: (session.user as any).id });
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
