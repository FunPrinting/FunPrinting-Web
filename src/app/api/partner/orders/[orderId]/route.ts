import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    let userId;
    const session = await getServerSession(authOptions);
    
    if (session && session.user) {
      userId = (session.user as any).id;
    } else {
      // Phase 4: Fallback to Bearer token for Desktop/Mobile Apps
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          // Basic base64 decode for now (in production, use jsonwebtoken verify)
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

    // Verify the caller is a partner
    const partner = await Partner.findOne({ userId: userId });
    if (!partner) {
      return NextResponse.json({ success: false, error: 'Partner profile not found' }, { status: 404 });
    }

    const { status } = await request.json();
    if (!status) {
      return NextResponse.json({ success: false, error: 'Missing status update' }, { status: 400 });
    }

    const resolvedParams = await params;
    
    // Find order and ensure it belongs to this partner
    const order = await Order.findOne({ 
      orderId: resolvedParams.orderId,
      partnerId: partner._id.toString()
    });

    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found or unauthorized' }, { status: 404 });
    }

    // Update status (both legacy and new format)
    order.status = status;
    order.orderStatus = status;
    await order.save();

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Error updating order status:', error);
    return NextResponse.json({ success: false, error: 'Failed to update order status' }, { status: 500 });
  }
}
