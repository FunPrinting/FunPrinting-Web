import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const resolvedParams = await params;

    const order = await Order.findOne({ 
      orderId: resolvedParams.orderId,
      userId: (session.user as any).id
    }).lean();

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Explicitly fetch partner details to hydrate the response for the Success Page
    if (order.partnerId) {
      const partner = await Partner.findById(order.partnerId).select('businessName address location isOnline isActive phoneNumbers deliveryPoints').lean();
      if (partner) {
        order.partnerDetails = partner;
      }
    }

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Error fetching user order:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch order details' }, { status: 500 });
  }
}
