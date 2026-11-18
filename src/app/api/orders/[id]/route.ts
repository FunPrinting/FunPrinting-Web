import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { requireUser, canAccessOrder } from '@/lib/authz';
import Payment from '@/models/Payment';
import { cancelPaymentLink } from '@/lib/payments/razorpayApi';
import { syncPaymentFromRazorpay } from '@/lib/payments/reconcile';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { id: orderId } = await params;
    console.log(`🗑️ Attempting to delete order with ID: ${orderId}`);
    
    // Find the order
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(orderId);
    const query = isObjectId ? { _id: orderId } : { orderId: orderId };
    const order = await Order.findOne(query);
    
    if (!order) {
      console.log(`❌ Order not found with ID: ${orderId}`);
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Only the order owner or an admin may access this order.
    // Respond 404 (not 403) so order IDs cannot be probed.
    if (!canAccessOrder(auth, order)) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    console.log(`📋 Found order: ${order.orderId}, paymentStatus: ${order.paymentStatus}, status: ${order.status}`);

    // Only allow deletion of pending payment orders
    if (order.paymentStatus !== 'pending' || order.status !== 'pending_payment') {
      console.log(`❌ Order ${order.orderId} cannot be deleted - not in pending payment state`);
      return NextResponse.json(
        { success: false, error: 'Only pending payment orders can be deleted' },
        { status: 400 }
      );
    }

    // Close any open payment link first, so the cancelled order can't be paid
    const open = await Payment.find({ orderId: order.orderId, status: 'created' }).select('referenceId razorpay.paymentLinkId').lean<Array<{ _id: unknown; referenceId: string; razorpay: { paymentLinkId?: string } }>>();
    for (const attempt of open) {
      try {
        if (attempt.razorpay.paymentLinkId) await cancelPaymentLink(attempt.razorpay.paymentLinkId);
        await Payment.updateOne({ _id: attempt._id as never, status: 'created' }, { $set: { status: 'cancelled' } });
      } catch {
        // Razorpay refuses to cancel a link that was just paid
        const status = await syncPaymentFromRazorpay(attempt.referenceId, 'return').catch(() => null);
        if (status === 'paid') {
          return NextResponse.json({ success: false, error: 'This order was just paid, so it can no longer be cancelled.' }, { status: 409 });
        }
      }
    }

    // Kept (not deleted) so a payment that still arrives finds its order and is reviewed
    await Order.updateOne({ _id: order._id, status: 'pending_payment' }, { $set: { status: 'cancelled', paymentStatus: 'failed' } });
    console.log(`✅ Order ${order.orderId} cancelled by user`);

    return NextResponse.json({
      success: true,
      message: 'Order cancelled'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete order' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { id: orderIdParam } = await params;
    
    // Find the order
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(orderIdParam);
    const query = isObjectId ? { _id: orderIdParam } : { orderId: orderIdParam };
    const order = await Order.findOne(query);
    
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Only the order owner or an admin may access this order.
    // Respond 404 (not 403) so order IDs cannot be probed.
    if (!canAccessOrder(auth, order)) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }
    
    // Find the partner if partnerId exists
    let partnerInfo = null;
    const partnerId = order.partnerId || order.deliveryOption?.partnerId;
    if (partnerId) {
      const partner = await Partner.findById(partnerId);
      if (partner) {
        partnerInfo = {
          businessName: partner.businessName,
          email: partner.email,
          phoneNumbers: partner.phoneNumbers,
          deliveryPoints: partner.deliveryPoints,
          address: partner.address
        };
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        ...order.toObject(),
        partnerInfo
      }
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}