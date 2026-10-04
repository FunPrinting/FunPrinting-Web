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

    // Fetch all orders for this user, sorted newest first
    const orders = await Order.find({ userId: (session.user as any).id })
      .sort({ createdAt: -1 })
      .lean();

    // Hydrate the orders with the basic Partner Info (Business Name)
    const hydratedOrders = await Promise.all(orders.map(async (order) => {
      if (order.partnerId) {
        const partner = await Partner.findById(order.partnerId).select('businessName location address').lean();
        if (partner) {
          order.partnerDetails = partner;
        }
      }
      return order;
    }));

    return NextResponse.json({ success: true, count: hydratedOrders.length, orders: hydratedOrders });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch user orders' }, { status: 500 });
  }
}
