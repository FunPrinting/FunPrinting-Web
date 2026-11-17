import { NextRequest, NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import Order from '@/models/Order';

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const { partner } = resolved;

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
